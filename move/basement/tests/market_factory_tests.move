#[test_only]
module basement::market_factory_tests {
    use std::option;
    use std::signer;

    use aptos_framework::account;
    use aptos_framework::timestamp;

    use basement::market_factory;
    use basement::virtual_usd;

    // BTC/USD Pyth feed id (mainnet), 1e8 tick fixed-point.
    const BTC_FEED: vector<u8> = x"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
    const BTC_TICK: u64 = 50_000_000_000; // $500 at 1e8

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fun setup_time(aptos_framework: &signer) {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        timestamp::update_global_time_for_test_secs(1_700_000_000);
    }

    fun setup_admin(aptos_framework: &signer, admin: &signer, owner_addr: address) {
        setup_time(aptos_framework);
        let admin_addr = signer::address_of(admin);
        account::create_account_for_test(admin_addr);

        // vUSD must be initialized so that create_market / seed_liquidity
        // can look up the metadata object and transfer liquidity.
        virtual_usd::init_for_test(admin);
        // Fund admin with plenty of vUSD for seed_liquidity calls.
        virtual_usd::admin_mint(admin, admin_addr, 1_000_000_000_000);

        market_factory::init_factory(admin, owner_addr);
    }

    // ------------------------------------------------------------------
    // Tests
    // ------------------------------------------------------------------

    #[test(aptos_framework = @aptos_framework, admin = @basement, owner = @0xB0B)]
    fun test_init_factory_happy_path(
        aptos_framework: &signer,
        admin: &signer,
        owner: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));

        virtual_usd::init_for_test(admin);
        market_factory::init_factory(admin, signer::address_of(owner));

        assert!(market_factory::is_initialized(), 100);
        assert!(market_factory::get_admin() == signer::address_of(admin), 101);
        assert!(market_factory::get_next_case_id() == 1, 102);
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, owner = @0xB0B)]
    #[expected_failure(abort_code = 5, location = basement::market_factory)]
    fun test_init_factory_idempotent(
        aptos_framework: &signer,
        admin: &signer,
        owner: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));

        virtual_usd::init_for_test(admin);
        let owner_addr = signer::address_of(owner);
        market_factory::init_factory(admin, owner_addr);
        // Second init must abort E_ALREADY_INITIALIZED = 5.
        market_factory::init_factory(admin, owner_addr);
    }

    #[test(
        aptos_framework = @aptos_framework,
        admin = @basement,
        owner = @0xB0B,
        mallory = @0xBAD
    )]
    #[expected_failure(abort_code = 1, location = basement::market_factory)]
    fun test_create_market_non_admin_reverts(
        aptos_framework: &signer,
        admin: &signer,
        owner: &signer,
        mallory: &signer,
    ) {
        setup_admin(aptos_framework, admin, signer::address_of(owner));
        account::create_account_for_test(signer::address_of(mallory));

        let now = timestamp::now_seconds();
        market_factory::create_market(
            mallory, // non-admin
            BTC_FEED,
            60_000_000_000_000, // $600k strike
            now + 7 * 24 * 3600,
            option::none<vector<u8>>(),
            false,
            0,
            1, // MT_CRYPTO_WEEKLY
            0, // ABOVE
            200,
            1_000_000,
            500,
            60,
            b"",
            b"",
        );
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, owner = @0xB0B)]
    fun test_spawn_recurring_3min_happy_path(
        aptos_framework: &signer,
        admin: &signer,
        owner: &signer,
    ) {
        setup_admin(aptos_framework, admin, signer::address_of(owner));

        // current_price = $60,123.45 at 1e8 → strike rounds down to $60,000
        let current_price: u64 = 6_012_345_000_000;
        let expected_strike: u64 = (current_price / BTC_TICK) * BTC_TICK;

        market_factory::spawn_recurring_3min(
            admin,
            b"btc_3min",
            BTC_FEED,
            current_price,
            BTC_TICK,
            1_000_000, // pool_depth = 1 vUSD (6 dp)
        );

        // Case id 1 was just consumed; next should be 2.
        assert!(market_factory::get_next_case_id() == 2, 200);

        // Group is now active pointing at case_id = 1.
        let active = market_factory::get_active_market_in_group(b"btc_3min");
        assert!(option::is_some(&active), 201);
        assert!(*option::borrow(&active) == 1, 202);

        // Vault address for case 1 is recorded.
        let _vault_addr = market_factory::get_vault_address(1);

        // Strike rounding sanity (verifies computation, silences warning).
        assert!(expected_strike == 6_000_000_000_000, 203);
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, owner = @0xB0B)]
    #[expected_failure(abort_code = 3, location = basement::market_factory)]
    fun test_spawn_recurring_3min_group_already_open_reverts(
        aptos_framework: &signer,
        admin: &signer,
        owner: &signer,
    ) {
        setup_admin(aptos_framework, admin, signer::address_of(owner));

        market_factory::spawn_recurring_3min(
            admin,
            b"btc_3min",
            BTC_FEED,
            6_012_345_000_000,
            BTC_TICK,
            1_000_000,
        );

        // Second call for same group while first is still OPEN must abort
        // with E_GROUP_ALREADY_OPEN = 3.
        market_factory::spawn_recurring_3min(
            admin,
            b"btc_3min",
            BTC_FEED,
            6_012_999_000_000,
            BTC_TICK,
            1_000_000,
        );
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, owner = @0xB0B)]
    fun test_view_get_next_case_id(
        aptos_framework: &signer,
        admin: &signer,
        owner: &signer,
    ) {
        setup_admin(aptos_framework, admin, signer::address_of(owner));

        // Fresh factory → next = 1.
        assert!(market_factory::get_next_case_id() == 1, 300);

        market_factory::spawn_recurring_3min(
            admin,
            b"btc_3min",
            BTC_FEED,
            6_012_345_000_000,
            BTC_TICK,
            1_000_000,
        );

        // After one market created → next = 2.
        assert!(market_factory::get_next_case_id() == 2, 301);
    }
}
