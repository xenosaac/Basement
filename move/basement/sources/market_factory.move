/// basement::market_factory
///
/// Admin-gated creator of CaseVault instances. Owns a global `FactoryConfig`
/// resource published at the `@basement` module address which tracks:
///  - admin / owner
///  - next case id counter
///  - `created_cases`: case_id -> vault object address (all cases ever created)
///  - `active_by_group`: group_id -> case_id (currently-OPEN recurring markets)
///
/// Friend wiring:
///  - We declare `basement::case_vault` as a friend so `resolve_oracle` can
///    call `spawn_next(old_case_id)` for auto-recurring markets.
///  - We call `case_vault::init_case` + `case_vault::seed_liquidity` which
///    are `public(friend)` on the case_vault side.
///
/// v0 notes:
///  - `spawn_next` is a stub that emits `SpawnRequestedEvent` so the backend
///    cron can handle actual re-spawn until v0.1.
///  - `active_by_group` may contain stale entries pointing to RESOLVED cases
///    if `case_vault::resolve_oracle` doesn't clear them; indexers must cross-
///    check state via views.
module basement::market_factory {
    use std::signer;
    use std::option::{Self, Option};

    use aptos_framework::event;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::object::{Self, Object};
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};

    use basement::case_vault::{Self, MarketConfig, CaseVault};
    use basement::virtual_usd;

    // NOTE: no `friend basement::case_vault` — Move rejects mutual friend+use cycles.
    // `spawn_next` and `clear_active_group` are exposed as admin-gated public entries
    // instead; backend cron listens to `ResolvedEvent` and calls them as admin.

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    const E_NOT_ADMIN: u64 = 1;
    const E_INVALID_CLOSE_TIME: u64 = 2;
    const E_GROUP_ALREADY_OPEN: u64 = 3;
    const E_UNKNOWN_CASE: u64 = 4;
    const E_ALREADY_INITIALIZED: u64 = 5;
    const E_NOT_INITIALIZED: u64 = 6;

    // ------------------------------------------------------------------
    // Market type constants (must stay in sync with basement::case_vault)
    // ------------------------------------------------------------------

    const MT_CRYPTO_3MIN: u8 = 0;
    const MT_CRYPTO_WEEKLY: u8 = 1;

    // ------------------------------------------------------------------
    // Resource
    // ------------------------------------------------------------------

    /// Global factory state. Lives at `@basement`.
    struct FactoryConfig has key {
        admin: address,
        owner: address,
        next_case_id: u64,
        /// case_id -> vault object address (every case ever created)
        created_cases: Table<u64, address>,
        /// recurring group_id -> currently-OPEN case_id
        active_by_group: Table<vector<u8>, u64>,
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    #[event]
    struct MarketCreatedEvent has drop, store {
        case_id: u64,
        vault_addr: address,
        asset_pyth_feed_id: vector<u8>,
        strike_price: u64,
        close_time: u64,
        market_type: u8,
        threshold_type: u8,
        recurring_group_id: Option<vector<u8>>,
    }

    #[event]
    struct SpawnRequestedEvent has drop, store {
        old_case_id: u64,
        requested_at: u64,
    }

    // ------------------------------------------------------------------
    // T2-02 — init_factory
    // ------------------------------------------------------------------

    /// One-shot admin bootstrap. Must be called by the publisher signer
    /// (address == @basement) so the FactoryConfig ends up at the module
    /// address. Aborts if already initialized.
    public entry fun init_factory(admin: &signer, owner: address) {
        let admin_addr = signer::address_of(admin);
        assert!(!exists<FactoryConfig>(@basement), E_ALREADY_INITIALIZED);
        // Only the @basement signer can publish the FactoryConfig here.
        assert!(admin_addr == @basement, E_NOT_ADMIN);

        move_to(
            admin,
            FactoryConfig {
                admin: admin_addr,
                owner,
                next_case_id: 1,
                created_cases: table::new<u64, address>(),
                active_by_group: table::new<vector<u8>, u64>(),
            }
        );
    }

    // ------------------------------------------------------------------
    // T2-03 — create_market (weekly + one-off)
    // ------------------------------------------------------------------

    /// Admin-gated creation of a new CaseVault. Handles both recurring
    /// (weekly, 3-min) and one-off markets. For recurring markets, the
    /// group_id must not already have an OPEN market.
    public entry fun create_market(
        admin: &signer,
        asset_pyth_feed_id: vector<u8>,
        strike_price: u64,
        close_time: u64,
        recurring_group_id: Option<vector<u8>>,
        recurring_auto_spawn: bool,
        recurring_duration_seconds: u64,
        market_type: u8,
        threshold_type: u8,
        fee_bps: u64,
        pool_depth: u64,
        max_trade_bps: u64,
        max_staleness_sec: u64,
        question_hash: vector<u8>,
        metadata_hash: vector<u8>,
    ) acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        let cfg = borrow_global_mut<FactoryConfig>(@basement);
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == cfg.admin, E_NOT_ADMIN);

        // Close time must be in the future.
        assert!(close_time > timestamp::now_seconds(), E_INVALID_CLOSE_TIME);

        // Recurring gate: group must not already be open.
        if (option::is_some(&recurring_group_id)) {
            let gid_ref = option::borrow(&recurring_group_id);
            assert!(
                !table::contains(&cfg.active_by_group, *gid_ref),
                E_GROUP_ALREADY_OPEN
            );
        };

        let case_id = cfg.next_case_id;
        cfg.next_case_id = case_id + 1;

        let market_config = case_vault::new_market_config(
            cfg.admin,
            cfg.owner,
            question_hash,
            metadata_hash,
            close_time,
            strike_price,
            asset_pyth_feed_id,
            market_type,
            threshold_type,
            fee_bps,
            max_trade_bps,
            max_staleness_sec,
            recurring_group_id,
            recurring_auto_spawn,
            recurring_duration_seconds,
        );

        let metadata: Object<Metadata> = object::address_to_object<Metadata>(
            virtual_usd::get_metadata_address()
        );

        let vault_obj: Object<CaseVault> =
            case_vault::init_case(admin, case_id, market_config, metadata);
        let vault_addr = object::object_address(&vault_obj);

        case_vault::seed_liquidity(admin, case_id, pool_depth);

        table::add(&mut cfg.created_cases, case_id, vault_addr);
        if (option::is_some(&recurring_group_id)) {
            let gid = *option::borrow(&recurring_group_id);
            table::add(&mut cfg.active_by_group, gid, case_id);
        };

        event::emit(
            MarketCreatedEvent {
                case_id,
                vault_addr,
                asset_pyth_feed_id,
                strike_price,
                close_time,
                market_type,
                threshold_type,
                recurring_group_id,
            }
        );
    }

    // ------------------------------------------------------------------
    // T2-06 — spawn_recurring_3min (admin entry, cron-friendly)
    // ------------------------------------------------------------------

    /// Admin entry to spawn a new 3-minute recurring market within
    /// `group_id`. Round `current_price` down to `tick_size` to derive the
    /// strike. close_time = now + 180s.
    public entry fun spawn_recurring_3min(
        admin: &signer,
        group_id: vector<u8>,
        asset_pyth_feed_id: vector<u8>,
        current_price: u64,
        tick_size: u64,
        pool_depth: u64,
    ) acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        let cfg = borrow_global_mut<FactoryConfig>(@basement);
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == cfg.admin, E_NOT_ADMIN);

        assert!(
            !table::contains(&cfg.active_by_group, group_id),
            E_GROUP_ALREADY_OPEN
        );

        let strike = (current_price / tick_size) * tick_size;
        let close_time = timestamp::now_seconds() + 180;

        let case_id = cfg.next_case_id;
        cfg.next_case_id = case_id + 1;

        let threshold_type: u8 = 0; // ABOVE
        let fee_bps: u64 = 200;
        let max_trade_bps: u64 = 500;
        let max_staleness_sec: u64 = 60;
        let recurring_group_id = option::some(group_id);

        let market_config = case_vault::new_market_config(
            cfg.admin,
            cfg.owner,
            b"", // question_hash (3-min recurring doesn't need it)
            b"", // metadata_hash
            close_time,
            strike,
            asset_pyth_feed_id,
            MT_CRYPTO_3MIN,
            threshold_type,
            fee_bps,
            max_trade_bps,
            max_staleness_sec,
            recurring_group_id,
            false, // backend cron handles spawn, not on-chain auto
            180,
        );

        let metadata: Object<Metadata> = object::address_to_object<Metadata>(
            virtual_usd::get_metadata_address()
        );

        let vault_obj: Object<CaseVault> =
            case_vault::init_case(admin, case_id, market_config, metadata);
        let vault_addr = object::object_address(&vault_obj);

        case_vault::seed_liquidity(admin, case_id, pool_depth);

        table::add(&mut cfg.created_cases, case_id, vault_addr);
        table::add(&mut cfg.active_by_group, group_id, case_id);

        event::emit(
            MarketCreatedEvent {
                case_id,
                vault_addr,
                asset_pyth_feed_id,
                strike_price: strike,
                close_time,
                market_type: MT_CRYPTO_3MIN,
                threshold_type,
                recurring_group_id,
            }
        );
    }

    // ------------------------------------------------------------------
    // T2-06 — spawn_next (friend-called stub)
    // ------------------------------------------------------------------

    /// Admin-gated successor-spawn trigger, called by backend cron after
    /// seeing a `ResolvedEvent` for a recurring weekly market. Cannot be a
    /// `friend` of `case_vault` (Move rejects mutual friend+use), so the
    /// call crosses out-of-chain via backend indexer.
    ///
    /// v0 stub: validates the old_case_id is known and emits a
    /// `SpawnRequestedEvent` the cron picks up to issue `create_market`.
    /// TODO: v0.1 fully implement in-entry spawn (read old config, derive
    /// new strike from Pyth, call init_case + seed_liquidity inline).
    public entry fun spawn_next(admin: &signer, old_case_id: u64) acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        let cfg = borrow_global<FactoryConfig>(@basement);
        assert!(signer::address_of(admin) == cfg.admin, E_NOT_ADMIN);
        assert!(table::contains(&cfg.created_cases, old_case_id), E_UNKNOWN_CASE);

        event::emit(
            SpawnRequestedEvent {
                old_case_id,
                requested_at: timestamp::now_seconds(),
            }
        );
    }

    // ------------------------------------------------------------------
    // T2-04 — View helpers
    // ------------------------------------------------------------------

    #[view]
    public fun get_vault_address(case_id: u64): address acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        let cfg = borrow_global<FactoryConfig>(@basement);
        assert!(table::contains(&cfg.created_cases, case_id), E_UNKNOWN_CASE);
        *table::borrow(&cfg.created_cases, case_id)
    }

    #[view]
    public fun get_active_market_in_group(
        group_id: vector<u8>
    ): Option<u64> acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        let cfg = borrow_global<FactoryConfig>(@basement);
        if (table::contains(&cfg.active_by_group, group_id)) {
            option::some(*table::borrow(&cfg.active_by_group, group_id))
        } else {
            option::none<u64>()
        }
    }

    #[view]
    public fun get_next_case_id(): u64 acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        borrow_global<FactoryConfig>(@basement).next_case_id
    }

    #[view]
    public fun get_admin(): address acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        borrow_global<FactoryConfig>(@basement).admin
    }

    #[view]
    public fun is_initialized(): bool {
        exists<FactoryConfig>(@basement)
    }

    // ------------------------------------------------------------------
    // Friend accessor: case_vault clears active_by_group on resolve/drain
    // ------------------------------------------------------------------

    /// Admin-gated active-group clear, called by backend cron after seeing
    /// a `ResolvedEvent` or `DrainedEvent` on a recurring case, so the same
    /// group_id can host a successor market.
    public entry fun clear_active_group(admin: &signer, group_id: vector<u8>) acquires FactoryConfig {
        assert!(exists<FactoryConfig>(@basement), E_NOT_INITIALIZED);
        let cfg = borrow_global_mut<FactoryConfig>(@basement);
        assert!(signer::address_of(admin) == cfg.admin, E_NOT_ADMIN);
        if (table::contains(&cfg.active_by_group, group_id)) {
            table::remove(&mut cfg.active_by_group, group_id);
        };
    }

    // ------------------------------------------------------------------
    // Test-only accessors
    // ------------------------------------------------------------------

    #[test_only]
    public fun e_not_admin(): u64 { E_NOT_ADMIN }
    #[test_only]
    public fun e_already_initialized(): u64 { E_ALREADY_INITIALIZED }
    #[test_only]
    public fun e_not_initialized(): u64 { E_NOT_INITIALIZED }
    #[test_only]
    public fun e_group_already_open(): u64 { E_GROUP_ALREADY_OPEN }
    #[test_only]
    public fun e_invalid_close_time(): u64 { E_INVALID_CLOSE_TIME }
    #[test_only]
    public fun e_unknown_case(): u64 { E_UNKNOWN_CASE }
}
