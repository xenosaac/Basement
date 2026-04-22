/// basement::case_vault — per-case CPMM vault (non-custodial).
///
/// Each case is its own object:
/// - Deterministic address = create_object_address(@basement_factory_signer, bcs(case_id))
/// - Holds its own YES + NO fungible asset (6 decimals, unlimited supply)
/// - Holds a virtual_usd primary store = the actual pot
/// - CPMM: x * y = k over (yes_reserve, no_reserve) "virtual" units
///
/// Non-custodial: all FA movement uses primary_fungible_store primitives.
/// Vault-owned transfers (sell payouts, claim payouts, emergency drain)
/// reconstruct the vault signer via ExtendRef.
///
/// State machine (one-way):
///   OPEN --admin_pause--> CLOSED --resolve_oracle/admin_resolve--> RESOLVED
///   OPEN --resolve_oracle/admin_resolve--> RESOLVED
///   OPEN/CLOSED --owner_emergency_drain--> INVALID (terminal)
module basement::case_vault {
    use std::bcs;
    use std::option::{Self, Option};
    use std::signer;
    use std::string;
    use std::vector;

    use aptos_framework::event;
    use aptos_framework::fungible_asset::{Self, BurnRef, Metadata, MintRef};
    use aptos_framework::object::{Self, ExtendRef, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;

    use basement::oracle;

    // NOTE: `friend basement::market_factory` would be the ideal gate for
    // `init_case` and `seed_liquidity`, but market_factory already declares
    // `friend basement::case_vault` to allow future spawn_next callbacks,
    // and bidirectional friend + an existing `use` edge creates a dependency
    // cycle that Move rejects. v0 exposes init_case + seed_liquidity as
    // plain `public` and relies on the factory-signer check (caller must
    // be the registered factory admin at @basement) for access control.

    // ------------------------------------------------------------------
    // States
    // ------------------------------------------------------------------
    const STATE_OPEN: u8 = 0;
    const STATE_CLOSED: u8 = 1;
    const STATE_RESOLVED: u8 = 2;
    const STATE_INVALID: u8 = 3;

    // ------------------------------------------------------------------
    // Outcomes
    // ------------------------------------------------------------------
    const OUTCOME_YES: u8 = 0;
    const OUTCOME_NO: u8 = 1;
    const OUTCOME_INVALID: u8 = 2;
    const OUTCOME_UNSET: u8 = 255;

    // ------------------------------------------------------------------
    // Market types
    // ------------------------------------------------------------------
    const MT_CRYPTO_3MIN: u8 = 0;
    const MT_CRYPTO_WEEKLY: u8 = 1;

    // ------------------------------------------------------------------
    // Threshold types (mirror oracle)
    // ------------------------------------------------------------------
    const TT_ABOVE: u8 = 0;
    const TT_BELOW: u8 = 1;
    const TT_EQ_ROUNDED: u8 = 2;

    // ------------------------------------------------------------------
    // Sides (for events)
    // ------------------------------------------------------------------
    const SIDE_YES: u8 = 0;
    const SIDE_NO: u8 = 1;

    // ------------------------------------------------------------------
    // Abort codes
    // ------------------------------------------------------------------
    const E_NOT_ADMIN: u64 = 1;
    const E_WRONG_STATE: u64 = 2;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 3;
    const E_SLIPPAGE: u64 = 4;
    const E_ALREADY_RESOLVED: u64 = 5;
    const E_NOT_RESOLVED: u64 = 6;
    const E_BAD_DESTINATION: u64 = 7;
    const E_ZERO_AMOUNT: u64 = 8;
    const E_TRADE_CAP_EXCEEDED: u64 = 9;
    const E_NOT_CLOSE_TIME: u64 = 10;
    const E_ORACLE_STALE: u64 = 11;
    const E_INSUFFICIENT_SHARES: u64 = 12;
    const E_NOT_OWNER: u64 = 13;
    const E_NOT_INITIALIZED: u64 = 14;
    const E_INVALID_OUTCOME: u64 = 15;

    // ------------------------------------------------------------------
    // BPS base
    // ------------------------------------------------------------------
    const BPS_BASE: u64 = 10_000;

    // ------------------------------------------------------------------
    // Resources
    // ------------------------------------------------------------------

    /// Per-case configuration captured at init_case time. Stored at the
    /// vault object address.
    struct MarketConfig has key, store {
        admin: address,
        owner: address,
        question_hash: vector<u8>,
        metadata_hash: vector<u8>,
        close_time: u64,
        strike_price: u64,
        asset_pyth_feed_id: vector<u8>,
        market_type: u8,
        threshold_type: u8,
        fee_bps: u64,
        max_trade_bps: u64,
        max_staleness_sec: u64,
        recurring_group_id: Option<vector<u8>>,
        recurring_auto_spawn: bool,
        recurring_duration_seconds: u64,
        created_at: u64,
    }

    /// The vault itself. Holds the YES/NO FA mint+burn refs and CPMM
    /// reserves. Lives at the same object address as MarketConfig.
    struct CaseVault has key {
        case_id: u64,
        yes_metadata: Object<Metadata>,
        no_metadata: Object<Metadata>,
        yes_mint_ref: MintRef,
        yes_burn_ref: BurnRef,
        no_mint_ref: MintRef,
        no_burn_ref: BurnRef,
        virtual_usd_metadata: Object<Metadata>,
        yes_reserve: u64,
        no_reserve: u64,
        state: u8,
        resolved_outcome: u8,
        extend_ref: ExtendRef,
    }

    /// Module-level owner / emergency-drain destination allowlist.
    /// v0 allows exactly one hardcoded destination.
    struct OwnerConfig has key {
        owner: address,
        protocol_vault_fallback: address,
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    #[event]
    struct CaseCreatedEvent has drop, store {
        case_id: u64,
        vault_addr: address,
        admin: address,
        close_time: u64,
        asset_pyth_feed_id: vector<u8>,
        strike_price: u64,
    }

    #[event]
    struct BoughtEvent has drop, store {
        case_id: u64,
        user: address,
        side: u8,
        amount_in: u64,
        shares_out: u64,
        yes_reserve_after: u64,
        no_reserve_after: u64,
    }

    #[event]
    struct SoldEvent has drop, store {
        case_id: u64,
        user: address,
        side: u8,
        shares_in: u64,
        amount_out: u64,
        yes_reserve_after: u64,
        no_reserve_after: u64,
    }

    #[event]
    struct ClaimedEvent has drop, store {
        case_id: u64,
        user: address,
        winning_side: u8,
        amount: u64,
    }

    #[event]
    struct ResolvedEvent has drop, store {
        case_id: u64,
        outcome: u8,
        oracle_price: u64,
        resolver: address,
        timestamp: u64,
    }

    #[event]
    struct PausedEvent has drop, store {
        case_id: u64,
        admin: address,
        timestamp: u64,
    }

    #[event]
    struct DrainedEvent has drop, store {
        case_id: u64,
        owner: address,
        destination: address,
        amount: u64,
        timestamp: u64,
    }

    #[event]
    struct LiquiditySeededEvent has drop, store {
        case_id: u64,
        amount: u64,
        yes_reserve_after: u64,
        no_reserve_after: u64,
    }

    // ------------------------------------------------------------------
    // Module init — hardcoded owner config
    // ------------------------------------------------------------------

    /// Called once on publish. Publisher is both owner and the
    /// protocol_vault_fallback destination for emergency drains in v0.
    fun init_module(deployer: &signer) {
        let deployer_addr = signer::address_of(deployer);
        move_to(
            deployer,
            OwnerConfig {
                owner: deployer_addr,
                protocol_vault_fallback: deployer_addr,
            }
        );
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// Derive the vault object address from `case_id` and the factory
    /// signer address (== @basement in v0).
    #[view]
    public fun vault_address_for(factory_addr: address, case_id: u64): address {
        object::create_object_address(&factory_addr, bcs::to_bytes(&case_id))
    }

    #[view]
    public fun state(vault_addr: address): u8 acquires CaseVault {
        borrow_global<CaseVault>(vault_addr).state
    }

    #[view]
    public fun reserves(vault_addr: address): (u64, u64) acquires CaseVault {
        let v = borrow_global<CaseVault>(vault_addr);
        (v.yes_reserve, v.no_reserve)
    }

    #[view]
    public fun resolved_outcome(vault_addr: address): u8 acquires CaseVault {
        borrow_global<CaseVault>(vault_addr).resolved_outcome
    }

    #[view]
    public fun yes_metadata(vault_addr: address): Object<Metadata> acquires CaseVault {
        borrow_global<CaseVault>(vault_addr).yes_metadata
    }

    #[view]
    public fun no_metadata(vault_addr: address): Object<Metadata> acquires CaseVault {
        borrow_global<CaseVault>(vault_addr).no_metadata
    }

    // ------------------------------------------------------------------
    // Config constructor — factory calls this to build a MarketConfig
    // before init_case. Kept as a plain `public` helper so off-chain
    // orchestration or tests can build one too.
    // ------------------------------------------------------------------

    public fun new_market_config(
        admin: address,
        owner: address,
        question_hash: vector<u8>,
        metadata_hash: vector<u8>,
        close_time: u64,
        strike_price: u64,
        asset_pyth_feed_id: vector<u8>,
        market_type: u8,
        threshold_type: u8,
        fee_bps: u64,
        max_trade_bps: u64,
        max_staleness_sec: u64,
        recurring_group_id: Option<vector<u8>>,
        recurring_auto_spawn: bool,
        recurring_duration_seconds: u64,
    ): MarketConfig {
        MarketConfig {
            admin,
            owner,
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
            created_at: timestamp::now_seconds(),
        }
    }

    // ------------------------------------------------------------------
    // init_case — friend entry from market_factory
    // ------------------------------------------------------------------

    public fun init_case(
        factory_signer: &signer,
        case_id: u64,
        config: MarketConfig,
        virtual_usd_metadata: Object<Metadata>,
    ): Object<CaseVault> {
        let seed = bcs::to_bytes(&case_id);
        let constructor_ref = object::create_named_object(factory_signer, seed);
        let vault_addr = object::address_from_constructor_ref(&constructor_ref);

        // YES FA
        let yes_symbol = build_symbol(b"YES_", case_id);
        let yes_constructor = object::create_named_object(
            factory_signer,
            build_fa_seed(b"yes_fa_", case_id)
        );
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &yes_constructor,
            option::none(),
            string::utf8(yes_symbol),
            string::utf8(yes_symbol),
            6,
            string::utf8(b""),
            string::utf8(b""),
        );
        let yes_mint_ref = fungible_asset::generate_mint_ref(&yes_constructor);
        let yes_burn_ref = fungible_asset::generate_burn_ref(&yes_constructor);
        let yes_metadata =
            object::object_from_constructor_ref<Metadata>(&yes_constructor);

        // NO FA
        let no_symbol = build_symbol(b"NO_", case_id);
        let no_constructor = object::create_named_object(
            factory_signer,
            build_fa_seed(b"no_fa_", case_id)
        );
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &no_constructor,
            option::none(),
            string::utf8(no_symbol),
            string::utf8(no_symbol),
            6,
            string::utf8(b""),
            string::utf8(b""),
        );
        let no_mint_ref = fungible_asset::generate_mint_ref(&no_constructor);
        let no_burn_ref = fungible_asset::generate_burn_ref(&no_constructor);
        let no_metadata =
            object::object_from_constructor_ref<Metadata>(&no_constructor);

        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let vault_signer = object::generate_signer(&constructor_ref);

        let admin_for_event = config.admin;
        let close_time_for_event = config.close_time;
        let feed_for_event = copy_bytes(&config.asset_pyth_feed_id);
        let strike_for_event = config.strike_price;

        move_to(&vault_signer, config);
        move_to(
            &vault_signer,
            CaseVault {
                case_id,
                yes_metadata,
                no_metadata,
                yes_mint_ref,
                yes_burn_ref,
                no_mint_ref,
                no_burn_ref,
                virtual_usd_metadata,
                yes_reserve: 0,
                no_reserve: 0,
                state: STATE_OPEN,
                resolved_outcome: OUTCOME_UNSET,
                extend_ref,
            }
        );

        event::emit(
            CaseCreatedEvent {
                case_id,
                vault_addr,
                admin: admin_for_event,
                close_time: close_time_for_event,
                asset_pyth_feed_id: feed_for_event,
                strike_price: strike_for_event,
            }
        );

        object::address_to_object<CaseVault>(vault_addr)
    }

    // ------------------------------------------------------------------
    // seed_liquidity — friend-only initial CPMM seed
    // ------------------------------------------------------------------

    public fun seed_liquidity(
        factory_signer: &signer,
        case_id: u64,
        amount: u64,
    ) acquires CaseVault {
        assert!(amount > 0, E_ZERO_AMOUNT);
        let factory_addr = signer::address_of(factory_signer);
        let vault_addr = vault_address_for(factory_addr, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(vault.state == STATE_OPEN, E_WRONG_STATE);

        // Pull vUSD from factory signer into vault's primary store.
        primary_fungible_store::transfer(
            factory_signer,
            vault.virtual_usd_metadata,
            vault_addr,
            amount
        );

        // Mint `amount` of each side into the vault's own primary stores.
        // (These are "virtual" reserves — nobody holds these shares yet.
        // They represent the CPMM curve. Users only get shares via buy.)
        primary_fungible_store::mint(&vault.yes_mint_ref, vault_addr, amount);
        primary_fungible_store::mint(&vault.no_mint_ref, vault_addr, amount);

        vault.yes_reserve = vault.yes_reserve + amount;
        vault.no_reserve = vault.no_reserve + amount;

        event::emit(
            LiquiditySeededEvent {
                case_id,
                amount,
                yes_reserve_after: vault.yes_reserve,
                no_reserve_after: vault.no_reserve,
            }
        );
    }

    // ------------------------------------------------------------------
    // Internal CPMM math
    // ------------------------------------------------------------------

    /// Given reserves and net-of-fee amount_in on one side, return
    /// shares_out on the opposite side.
    /// shares_out = reserve_out - k / (reserve_in + amount_in)
    fun cpmm_shares_out(
        reserve_in: u64,
        reserve_out: u64,
        amount_in_after_fee: u64,
    ): u64 {
        assert!(reserve_in > 0 && reserve_out > 0, E_INSUFFICIENT_LIQUIDITY);
        // Use u128 to avoid overflow on the k = reserve_in * reserve_out.
        let k = (reserve_in as u128) * (reserve_out as u128);
        let new_reserve_in = (reserve_in as u128) + (amount_in_after_fee as u128);
        // Ceiling-div to be conservative on new_reserve_out (keep dust in vault).
        let new_reserve_out = k / new_reserve_in;
        let shares_u128 = (reserve_out as u128) - new_reserve_out;
        (shares_u128 as u64)
    }

    /// Inverse: user burns shares_in on one side, gets amount_out vUSD out.
    /// Uses symmetric CPMM assumption: selling YES shares burns them and
    /// removes YES reserve; vault pays vUSD from pot equal to delta on NO
    /// side so the curve is maintained.
    ///
    /// Actually in this minimal CPMM we use the simpler mirror:
    /// shares_in of YES are burned → yes_reserve += shares_in (since those
    /// were outside-curve user shares coming back); then new_no_reserve
    /// = k / new_yes_reserve; amount_out = no_reserve - new_no_reserve.
    /// Fee is skimmed from amount_out.
    fun cpmm_amount_out(
        reserve_in: u64,
        reserve_out: u64,
        shares_in: u64,
    ): u64 {
        assert!(reserve_in > 0 && reserve_out > 0, E_INSUFFICIENT_LIQUIDITY);
        let k = (reserve_in as u128) * (reserve_out as u128);
        let new_reserve_in = (reserve_in as u128) + (shares_in as u128);
        let new_reserve_out = k / new_reserve_in;
        let amount_u128 = (reserve_out as u128) - new_reserve_out;
        (amount_u128 as u64)
    }

    // ------------------------------------------------------------------
    // buy_yes / buy_no
    // ------------------------------------------------------------------

    public entry fun buy_yes(
        user: &signer,
        case_id: u64,
        amount_in: u64,
        min_shares_out: u64,
    ) acquires CaseVault, MarketConfig {
        buy_internal(user, case_id, amount_in, min_shares_out, SIDE_YES);
    }

    public entry fun buy_no(
        user: &signer,
        case_id: u64,
        amount_in: u64,
        min_shares_out: u64,
    ) acquires CaseVault, MarketConfig {
        buy_internal(user, case_id, amount_in, min_shares_out, SIDE_NO);
    }

    fun buy_internal(
        user: &signer,
        case_id: u64,
        amount_in: u64,
        min_shares_out: u64,
        side: u8,
    ) acquires CaseVault, MarketConfig {
        assert!(amount_in > 0, E_ZERO_AMOUNT);
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);
        let max_trade_bps = borrow_market_config_max_trade_bps(vault_addr);
        let fee_bps = borrow_market_config_fee_bps(vault_addr);

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(vault.state == STATE_OPEN, E_WRONG_STATE);

        let total_reserve = vault.yes_reserve + vault.no_reserve;
        assert!(
            (amount_in as u128) * (BPS_BASE as u128)
                <= (total_reserve as u128) * (max_trade_bps as u128),
            E_TRADE_CAP_EXCEEDED
        );

        let user_addr = signer::address_of(user);

        // Pull vUSD from user → vault.
        primary_fungible_store::transfer(
            user,
            vault.virtual_usd_metadata,
            vault_addr,
            amount_in
        );

        let amount_in_after_fee =
            amount_in * (BPS_BASE - fee_bps) / BPS_BASE;

        let shares_out;
        if (side == SIDE_YES) {
            // Buying YES: NO reserve grows by amount_in_after_fee,
            // YES reserve shrinks by shares_out.
            shares_out = cpmm_shares_out(
                vault.no_reserve, // reserve_in (grows)
                vault.yes_reserve, // reserve_out (shrinks)
                amount_in_after_fee
            );
            assert!(shares_out > 0, E_INSUFFICIENT_LIQUIDITY);
            assert!(shares_out < vault.yes_reserve, E_INSUFFICIENT_LIQUIDITY);
            assert!(shares_out >= min_shares_out, E_SLIPPAGE);

            // Transfer shares out of vault's primary store to user.
            let vault_signer =
                object::generate_signer_for_extending(&vault.extend_ref);
            primary_fungible_store::transfer(
                &vault_signer,
                vault.yes_metadata,
                user_addr,
                shares_out
            );

            vault.yes_reserve = vault.yes_reserve - shares_out;
            vault.no_reserve = vault.no_reserve + amount_in_after_fee;
        } else {
            shares_out = cpmm_shares_out(
                vault.yes_reserve,
                vault.no_reserve,
                amount_in_after_fee
            );
            assert!(shares_out > 0, E_INSUFFICIENT_LIQUIDITY);
            assert!(shares_out < vault.no_reserve, E_INSUFFICIENT_LIQUIDITY);
            assert!(shares_out >= min_shares_out, E_SLIPPAGE);

            let vault_signer =
                object::generate_signer_for_extending(&vault.extend_ref);
            primary_fungible_store::transfer(
                &vault_signer,
                vault.no_metadata,
                user_addr,
                shares_out
            );

            vault.yes_reserve = vault.yes_reserve + amount_in_after_fee;
            vault.no_reserve = vault.no_reserve - shares_out;
        };

        event::emit(
            BoughtEvent {
                case_id,
                user: user_addr,
                side,
                amount_in,
                shares_out,
                yes_reserve_after: vault.yes_reserve,
                no_reserve_after: vault.no_reserve,
            }
        );
    }

    // ------------------------------------------------------------------
    // sell_yes / sell_no
    // ------------------------------------------------------------------

    public entry fun sell_yes(
        user: &signer,
        case_id: u64,
        shares_in: u64,
        min_amount_out: u64,
    ) acquires CaseVault, MarketConfig {
        sell_internal(user, case_id, shares_in, min_amount_out, SIDE_YES);
    }

    public entry fun sell_no(
        user: &signer,
        case_id: u64,
        shares_in: u64,
        min_amount_out: u64,
    ) acquires CaseVault, MarketConfig {
        sell_internal(user, case_id, shares_in, min_amount_out, SIDE_NO);
    }

    fun sell_internal(
        user: &signer,
        case_id: u64,
        shares_in: u64,
        min_amount_out: u64,
        side: u8,
    ) acquires CaseVault, MarketConfig {
        assert!(shares_in > 0, E_ZERO_AMOUNT);
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);
        let fee_bps = borrow_market_config_fee_bps(vault_addr);

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(vault.state == STATE_OPEN, E_WRONG_STATE);

        let user_addr = signer::address_of(user);

        // Burn user's shares.
        let (burn_ref_side, share_metadata) = if (side == SIDE_YES) {
            (&vault.yes_burn_ref, vault.yes_metadata)
        } else {
            (&vault.no_burn_ref, vault.no_metadata)
        };
        // Check balance first for a clean abort.
        let bal =
            primary_fungible_store::balance(user_addr, share_metadata);
        assert!(bal >= shares_in, E_INSUFFICIENT_SHARES);
        primary_fungible_store::burn(burn_ref_side, user_addr, shares_in);

        // Compute amount_out via CPMM.
        let amount_out_gross;
        if (side == SIDE_YES) {
            // Selling YES: YES reserve grows by shares_in, NO shrinks.
            amount_out_gross = cpmm_amount_out(
                vault.yes_reserve,
                vault.no_reserve,
                shares_in
            );
            vault.yes_reserve = vault.yes_reserve + shares_in;
            vault.no_reserve = vault.no_reserve - amount_out_gross;
        } else {
            amount_out_gross = cpmm_amount_out(
                vault.no_reserve,
                vault.yes_reserve,
                shares_in
            );
            vault.no_reserve = vault.no_reserve + shares_in;
            vault.yes_reserve = vault.yes_reserve - amount_out_gross;
        };

        let amount_out = amount_out_gross * (BPS_BASE - fee_bps) / BPS_BASE;
        assert!(amount_out > 0, E_INSUFFICIENT_LIQUIDITY);
        assert!(amount_out >= min_amount_out, E_SLIPPAGE);

        // Payout vUSD from vault → user.
        let vault_signer =
            object::generate_signer_for_extending(&vault.extend_ref);
        primary_fungible_store::transfer(
            &vault_signer,
            vault.virtual_usd_metadata,
            user_addr,
            amount_out
        );

        event::emit(
            SoldEvent {
                case_id,
                user: user_addr,
                side,
                shares_in,
                amount_out,
                yes_reserve_after: vault.yes_reserve,
                no_reserve_after: vault.no_reserve,
            }
        );
    }

    // ------------------------------------------------------------------
    // claim_winnings
    // ------------------------------------------------------------------

    public entry fun claim_winnings(
        user: &signer,
        case_id: u64,
    ) acquires CaseVault {
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);
        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(vault.state == STATE_RESOLVED, E_NOT_RESOLVED);

        let user_addr = signer::address_of(user);
        let outcome = vault.resolved_outcome;

        let vault_signer =
            object::generate_signer_for_extending(&vault.extend_ref);

        if (outcome == OUTCOME_YES || outcome == OUTCOME_NO) {
            let (winning_metadata, winning_burn_ref, winning_side) =
                if (outcome == OUTCOME_YES) {
                    (vault.yes_metadata, &vault.yes_burn_ref, SIDE_YES)
                } else {
                    (vault.no_metadata, &vault.no_burn_ref, SIDE_NO)
                };
            let shares =
                primary_fungible_store::balance(user_addr, winning_metadata);
            assert!(shares > 0, E_ZERO_AMOUNT);
            primary_fungible_store::burn(winning_burn_ref, user_addr, shares);
            // 1 share == 1 vUSD at resolution (standard binary-option pricing).
            primary_fungible_store::transfer(
                &vault_signer,
                vault.virtual_usd_metadata,
                user_addr,
                shares
            );
            event::emit(
                ClaimedEvent {
                    case_id,
                    user: user_addr,
                    winning_side,
                    amount: shares,
                }
            );
        } else if (outcome == OUTCOME_INVALID) {
            // Pro-rata refund: user burns ALL their YES+NO shares; gets
            // vUSD = (yes + no) * vault_vusd_balance / (yes_reserve + no_reserve).
            let yes_bal =
                primary_fungible_store::balance(user_addr, vault.yes_metadata);
            let no_bal =
                primary_fungible_store::balance(user_addr, vault.no_metadata);
            let total_user = yes_bal + no_bal;
            assert!(total_user > 0, E_ZERO_AMOUNT);

            if (yes_bal > 0) {
                primary_fungible_store::burn(
                    &vault.yes_burn_ref,
                    user_addr,
                    yes_bal
                );
            };
            if (no_bal > 0) {
                primary_fungible_store::burn(
                    &vault.no_burn_ref,
                    user_addr,
                    no_bal
                );
            };

            let vault_vusd =
                primary_fungible_store::balance(vault_addr, vault.virtual_usd_metadata);
            let total_reserve = vault.yes_reserve + vault.no_reserve;
            assert!(total_reserve > 0, E_INSUFFICIENT_LIQUIDITY);
            let refund_u128 =
                (total_user as u128) * (vault_vusd as u128)
                    / (total_reserve as u128);
            let refund = (refund_u128 as u64);
            assert!(refund > 0, E_ZERO_AMOUNT);

            primary_fungible_store::transfer(
                &vault_signer,
                vault.virtual_usd_metadata,
                user_addr,
                refund
            );
            event::emit(
                ClaimedEvent {
                    case_id,
                    user: user_addr,
                    winning_side: OUTCOME_INVALID,
                    amount: refund,
                }
            );
        } else {
            abort E_INVALID_OUTCOME
        }
    }

    // ------------------------------------------------------------------
    // resolve_oracle
    // ------------------------------------------------------------------

    public entry fun resolve_oracle(
        user: &signer,
        case_id: u64,
        vaa_bytes: vector<u8>,
    ) acquires CaseVault, MarketConfig {
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);

        let now = timestamp::now_seconds();
        let cfg = borrow_global<MarketConfig>(vault_addr);
        assert!(now >= cfg.close_time, E_NOT_CLOSE_TIME);

        {
            let v_check = borrow_global<CaseVault>(vault_addr);
            assert!(
                v_check.state == STATE_OPEN || v_check.state == STATE_CLOSED,
                E_WRONG_STATE
            );
        };

        oracle::update_price_feeds(user, vaa_bytes);
        let (price, _conf, _ts) = oracle::get_price_no_older_than(
            copy_bytes(&cfg.asset_pyth_feed_id),
            cfg.max_staleness_sec
        );
        let outcome = oracle::compute_outcome(
            price,
            cfg.strike_price,
            cfg.threshold_type
        );

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        vault.state = STATE_RESOLVED;
        vault.resolved_outcome = outcome;

        let resolver_addr = signer::address_of(user);
        event::emit(
            ResolvedEvent {
                case_id,
                outcome,
                oracle_price: price,
                resolver: resolver_addr,
                timestamp: now,
            }
        );

        // NOTE: cross-module friend call to market_factory::spawn_next
        // would go here for MT_CRYPTO_WEEKLY + recurring_auto_spawn.
        // Omitted in v0 to keep case_vault self-contained; factory/cron
        // owns spawn scheduling.
    }

    // ------------------------------------------------------------------
    // admin_resolve — fallback when oracle is unavailable
    // ------------------------------------------------------------------

    public entry fun admin_resolve(
        admin: &signer,
        case_id: u64,
        outcome: u8,
    ) acquires CaseVault, MarketConfig {
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);

        let cfg = borrow_global<MarketConfig>(vault_addr);
        assert!(signer::address_of(admin) == cfg.admin, E_NOT_ADMIN);
        assert!(
            outcome == OUTCOME_YES
                || outcome == OUTCOME_NO
                || outcome == OUTCOME_INVALID,
            E_INVALID_OUTCOME
        );

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(
            vault.state == STATE_OPEN || vault.state == STATE_CLOSED,
            E_WRONG_STATE
        );
        vault.state = STATE_RESOLVED;
        vault.resolved_outcome = outcome;

        event::emit(
            ResolvedEvent {
                case_id,
                outcome,
                oracle_price: 0,
                resolver: signer::address_of(admin),
                timestamp: timestamp::now_seconds(),
            }
        );
    }

    // ------------------------------------------------------------------
    // admin_pause — OPEN → CLOSED (one-way)
    // ------------------------------------------------------------------

    public entry fun admin_pause(
        admin: &signer,
        case_id: u64,
    ) acquires CaseVault, MarketConfig {
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);

        let cfg = borrow_global<MarketConfig>(vault_addr);
        assert!(signer::address_of(admin) == cfg.admin, E_NOT_ADMIN);

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(vault.state == STATE_OPEN, E_WRONG_STATE);
        vault.state = STATE_CLOSED;

        event::emit(
            PausedEvent {
                case_id,
                admin: signer::address_of(admin),
                timestamp: timestamp::now_seconds(),
            }
        );
    }

    // ------------------------------------------------------------------
    // owner_emergency_drain — terminal INVALID
    // ------------------------------------------------------------------

    public entry fun owner_emergency_drain(
        owner: &signer,
        case_id: u64,
        destination: address,
    ) acquires CaseVault, MarketConfig, OwnerConfig {
        let vault_addr = vault_address_for(@basement, case_id);
        assert!(exists<CaseVault>(vault_addr), E_NOT_INITIALIZED);
        assert!(exists<OwnerConfig>(@basement), E_NOT_INITIALIZED);

        let cfg = borrow_global<MarketConfig>(vault_addr);
        let owner_addr = signer::address_of(owner);
        assert!(owner_addr == cfg.owner, E_NOT_OWNER);

        let oc = borrow_global<OwnerConfig>(@basement);
        assert!(destination == oc.protocol_vault_fallback, E_BAD_DESTINATION);

        let vault = borrow_global_mut<CaseVault>(vault_addr);
        assert!(
            vault.state == STATE_OPEN || vault.state == STATE_CLOSED,
            E_WRONG_STATE
        );

        let bal =
            primary_fungible_store::balance(vault_addr, vault.virtual_usd_metadata);
        let vault_signer =
            object::generate_signer_for_extending(&vault.extend_ref);
        if (bal > 0) {
            primary_fungible_store::transfer(
                &vault_signer,
                vault.virtual_usd_metadata,
                destination,
                bal
            );
        };

        vault.state = STATE_INVALID;

        event::emit(
            DrainedEvent {
                case_id,
                owner: owner_addr,
                destination,
                amount: bal,
                timestamp: timestamp::now_seconds(),
            }
        );
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    fun build_symbol(prefix: vector<u8>, case_id: u64): vector<u8> {
        let out = copy_bytes(&prefix);
        let id_bytes = u64_to_ascii(case_id);
        vector::append(&mut out, id_bytes);
        out
    }

    fun build_fa_seed(prefix: vector<u8>, case_id: u64): vector<u8> {
        let out = copy_bytes(&prefix);
        vector::append(&mut out, bcs::to_bytes(&case_id));
        out
    }

    fun copy_bytes(src: &vector<u8>): vector<u8> {
        let out = vector::empty<u8>();
        let i = 0;
        let n = vector::length(src);
        while (i < n) {
            vector::push_back(&mut out, *vector::borrow(src, i));
            i = i + 1;
        };
        out
    }

    fun u64_to_ascii(mut_n: u64): vector<u8> {
        if (mut_n == 0) {
            let z = vector::empty<u8>();
            vector::push_back(&mut z, 48u8);
            return z
        };
        let buf = vector::empty<u8>();
        let n = mut_n;
        while (n > 0) {
            let d = ((n % 10) as u8);
            vector::push_back(&mut buf, 48u8 + d);
            n = n / 10;
        };
        // reverse
        let out = vector::empty<u8>();
        let len = vector::length(&buf);
        let i = len;
        while (i > 0) {
            i = i - 1;
            vector::push_back(&mut out, *vector::borrow(&buf, i));
        };
        out
    }

    fun borrow_market_config_fee_bps(vault_addr: address): u64 acquires MarketConfig {
        borrow_global<MarketConfig>(vault_addr).fee_bps
    }

    fun borrow_market_config_max_trade_bps(vault_addr: address): u64 acquires MarketConfig {
        borrow_global<MarketConfig>(vault_addr).max_trade_bps
    }

    // ------------------------------------------------------------------
    // Test-only helpers
    // ------------------------------------------------------------------

    #[test_only]
    public fun init_for_test(deployer: &signer) {
        init_module(deployer);
    }

    #[test_only]
    public fun test_init_case(
        factory_signer: &signer,
        case_id: u64,
        config: MarketConfig,
        virtual_usd_metadata: Object<Metadata>,
    ): Object<CaseVault> {
        init_case(factory_signer, case_id, config, virtual_usd_metadata)
    }

    #[test_only]
    public fun test_seed_liquidity(
        factory_signer: &signer,
        case_id: u64,
        amount: u64,
    ) acquires CaseVault {
        seed_liquidity(factory_signer, case_id, amount)
    }

    #[test_only]
    public fun e_wrong_state(): u64 { E_WRONG_STATE }
    #[test_only]
    public fun e_slippage(): u64 { E_SLIPPAGE }
    #[test_only]
    public fun e_zero_amount(): u64 { E_ZERO_AMOUNT }
    #[test_only]
    public fun e_trade_cap_exceeded(): u64 { E_TRADE_CAP_EXCEEDED }
    #[test_only]
    public fun e_not_close_time(): u64 { E_NOT_CLOSE_TIME }
    #[test_only]
    public fun e_insufficient_shares(): u64 { E_INSUFFICIENT_SHARES }
    #[test_only]
    public fun e_not_admin(): u64 { E_NOT_ADMIN }
    #[test_only]
    public fun e_not_owner(): u64 { E_NOT_OWNER }
    #[test_only]
    public fun e_bad_destination(): u64 { E_BAD_DESTINATION }
    #[test_only]
    public fun e_not_resolved(): u64 { E_NOT_RESOLVED }
    #[test_only]
    public fun e_invalid_outcome(): u64 { E_INVALID_OUTCOME }

    #[test_only]
    public fun state_open(): u8 { STATE_OPEN }
    #[test_only]
    public fun state_closed(): u8 { STATE_CLOSED }
    #[test_only]
    public fun state_resolved(): u8 { STATE_RESOLVED }
    #[test_only]
    public fun state_invalid(): u8 { STATE_INVALID }
    #[test_only]
    public fun outcome_yes(): u8 { OUTCOME_YES }
    #[test_only]
    public fun outcome_no(): u8 { OUTCOME_NO }
    #[test_only]
    public fun outcome_invalid(): u8 { OUTCOME_INVALID }
    #[test_only]
    public fun tt_above(): u8 { TT_ABOVE }
    #[test_only]
    public fun tt_below(): u8 { TT_BELOW }
    #[test_only]
    public fun mt_crypto_3min(): u8 { MT_CRYPTO_3MIN }
    #[test_only]
    public fun mt_crypto_weekly(): u8 { MT_CRYPTO_WEEKLY }
}
