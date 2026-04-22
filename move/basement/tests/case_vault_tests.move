#[test_only]
module basement::case_vault_tests {
    use std::option;
    use std::signer;
    use std::vector;

    use aptos_framework::account;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::object::Object;
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;

    use basement::case_vault;
    use basement::virtual_usd;

    // Test constants — use dev-address @basement = 0xCAFE
    const FEE_BPS: u64 = 100; // 1%
    const MAX_TRADE_BPS: u64 = 500; // 5%
    const MAX_STALENESS: u64 = 60;
    const SEED_AMOUNT: u64 = 1_000_000_000; // 1000 vUSD (6 dp)
    const STRIKE: u64 = 50_000_00000000; // $50k at 8 dp (unused in admin-resolve path tests)

    const BTC_FEED_ID: vector<u8> =
        x"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

    fun setup_env(
        aptos_framework: &signer,
        deployer: &signer,
    ) {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        account::create_account_for_test(signer::address_of(deployer));
        virtual_usd::init_for_test(deployer);
        case_vault::init_for_test(deployer);
    }

    fun make_user(addr: address): signer {
        account::create_account_for_test(addr);
        account::create_signer_for_test(addr)
    }

    fun fund_user(admin: &signer, user: address, amount: u64) {
        virtual_usd::admin_mint(admin, user, amount);
    }

    fun vusd_metadata(): Object<Metadata> {
        let addr = virtual_usd::get_metadata_address();
        aptos_framework::object::address_to_object<Metadata>(addr)
    }

    fun default_config(admin: address, owner: address, close_time: u64)
        : case_vault::MarketConfig
    {
        case_vault::new_market_config(
            admin,
            owner,
            b"q_hash",
            b"m_hash",
            close_time,
            STRIKE,
            BTC_FEED_ID,
            case_vault::mt_crypto_weekly(),
            case_vault::tt_above(),
            FEE_BPS,
            MAX_TRADE_BPS,
            MAX_STALENESS,
            option::none<vector<u8>>(),
            false,
            0,
        )
    }

    fun init_case_seeded(
        deployer: &signer,
        case_id: u64,
        close_time: u64,
    ) {
        let admin_addr = signer::address_of(deployer);
        let cfg = default_config(admin_addr, admin_addr, close_time);
        case_vault::test_init_case(deployer, case_id, cfg, vusd_metadata());
        // Fund factory with seed liquidity vUSD.
        virtual_usd::admin_mint(deployer, admin_addr, SEED_AMOUNT);
        case_vault::test_seed_liquidity(deployer, case_id, SEED_AMOUNT);
    }

    // ---------------- tests ----------------

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_01_init_and_seed(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let vault_addr = case_vault::vault_address_for(@basement, 1);
        let (y, n) = case_vault::reserves(vault_addr);
        assert!(y == SEED_AMOUNT, 100);
        assert!(n == SEED_AMOUNT, 101);
        assert!(case_vault::state(vault_addr) == case_vault::state_open(), 102);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_02_buy_yes_basic(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let user_addr = @0xA1;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000); // 10 vUSD

        case_vault::buy_yes(&user, 1, 10_000_000, 1);
        let yes_md = case_vault::yes_metadata(case_vault::vault_address_for(@basement, 1));
        let bal = primary_fungible_store::balance(user_addr, yes_md);
        assert!(bal > 0, 200);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_03_buy_no_basic(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let user_addr = @0xA2;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);

        case_vault::buy_no(&user, 1, 10_000_000, 1);
        let no_md = case_vault::no_metadata(case_vault::vault_address_for(@basement, 1));
        let bal = primary_fungible_store::balance(user_addr, no_md);
        assert!(bal > 0, 300);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 8, location = basement::case_vault)]
    fun test_04_buy_zero_aborts(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let user_addr = @0xA3;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 1_000_000);
        case_vault::buy_yes(&user, 1, 0, 0);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 9, location = basement::case_vault)]
    fun test_05_trade_cap_exceeded(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let user_addr = @0xA4;
        let user = make_user(user_addr);
        // 5% of (2 * SEED_AMOUNT) = 100_000_000. Try 200_000_000.
        fund_user(deployer, user_addr, 500_000_000);
        case_vault::buy_yes(&user, 1, 200_000_000, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 4, location = basement::case_vault)]
    fun test_06_slippage_protection(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let user_addr = @0xA5;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);
        // Set min_shares_out absurdly high to force slippage.
        case_vault::buy_yes(&user, 1, 10_000_000, 1_000_000_000_000);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_07_sell_yes_roundtrip(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let user_addr = @0xA6;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);

        let vault_addr = case_vault::vault_address_for(@basement, 1);
        let yes_md = case_vault::yes_metadata(vault_addr);

        case_vault::buy_yes(&user, 1, 10_000_000, 1);
        let shares = primary_fungible_store::balance(user_addr, yes_md);
        assert!(shares > 0, 700);

        let vusd_before = primary_fungible_store::balance(user_addr, vusd_metadata());
        case_vault::sell_yes(&user, 1, shares, 1);
        let vusd_after = primary_fungible_store::balance(user_addr, vusd_metadata());
        assert!(vusd_after > vusd_before, 701);
        let shares_after = primary_fungible_store::balance(user_addr, yes_md);
        assert!(shares_after == 0, 702);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 12, location = basement::case_vault)]
    fun test_08_sell_insufficient_shares(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let user_addr = @0xA7;
        let user = make_user(user_addr);
        case_vault::sell_yes(&user, 1, 1_000, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_09_admin_pause(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        case_vault::admin_pause(deployer, 1);
        let vault_addr = case_vault::vault_address_for(@basement, 1);
        assert!(case_vault::state(vault_addr) == case_vault::state_closed(), 900);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 2, location = basement::case_vault)]
    fun test_10_buy_after_pause_aborts(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        case_vault::admin_pause(deployer, 1);
        let user_addr = @0xA8;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);
        case_vault::buy_yes(&user, 1, 10_000_000, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement, attacker = @0xBEEF)]
    #[expected_failure(abort_code = 1, location = basement::case_vault)]
    fun test_11_non_admin_pause_aborts(
        aptos_framework: &signer,
        deployer: &signer,
        attacker: &signer,
    ) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        account::create_account_for_test(signer::address_of(attacker));
        case_vault::admin_pause(attacker, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_12_admin_resolve_yes_and_claim(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let user_addr = @0xA9;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);
        case_vault::buy_yes(&user, 1, 10_000_000, 1);

        let vault_addr = case_vault::vault_address_for(@basement, 1);
        let yes_md = case_vault::yes_metadata(vault_addr);
        let shares_before = primary_fungible_store::balance(user_addr, yes_md);
        assert!(shares_before > 0, 1200);

        case_vault::admin_resolve(deployer, 1, case_vault::outcome_yes());
        assert!(case_vault::state(vault_addr) == case_vault::state_resolved(), 1201);
        assert!(case_vault::resolved_outcome(vault_addr) == case_vault::outcome_yes(), 1202);

        let vusd_before = primary_fungible_store::balance(user_addr, vusd_metadata());
        case_vault::claim_winnings(&user, 1);
        let vusd_after = primary_fungible_store::balance(user_addr, vusd_metadata());
        assert!(vusd_after - vusd_before == shares_before, 1203);

        let shares_after = primary_fungible_store::balance(user_addr, yes_md);
        assert!(shares_after == 0, 1204);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 8, location = basement::case_vault)]
    fun test_13_claim_twice_aborts(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let user_addr = @0xAA;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);
        case_vault::buy_yes(&user, 1, 10_000_000, 1);
        case_vault::admin_resolve(deployer, 1, case_vault::outcome_yes());
        case_vault::claim_winnings(&user, 1);
        case_vault::claim_winnings(&user, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 6, location = basement::case_vault)]
    fun test_14_claim_before_resolve_aborts(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let user_addr = @0xAB;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);
        case_vault::buy_yes(&user, 1, 10_000_000, 1);
        case_vault::claim_winnings(&user, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_15_admin_resolve_invalid_prorata_refund(
        aptos_framework: &signer,
        deployer: &signer,
    ) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let user_addr = @0xAC;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 20_000_000);
        case_vault::buy_yes(&user, 1, 10_000_000, 1);
        case_vault::buy_no(&user, 1, 10_000_000, 1);

        case_vault::admin_resolve(deployer, 1, case_vault::outcome_invalid());
        let vusd_before = primary_fungible_store::balance(user_addr, vusd_metadata());
        case_vault::claim_winnings(&user, 1);
        let vusd_after = primary_fungible_store::balance(user_addr, vusd_metadata());
        assert!(vusd_after > vusd_before, 1500);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement, attacker = @0xBEEF)]
    #[expected_failure(abort_code = 1, location = basement::case_vault)]
    fun test_16_non_admin_resolve_aborts(
        aptos_framework: &signer,
        deployer: &signer,
        attacker: &signer,
    ) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        account::create_account_for_test(signer::address_of(attacker));
        case_vault::admin_resolve(attacker, 1, case_vault::outcome_yes());
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_17_owner_emergency_drain(aptos_framework: &signer, deployer: &signer) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let dest = signer::address_of(deployer); // protocol_vault_fallback = deployer
        let vault_addr = case_vault::vault_address_for(@basement, 1);
        let vault_bal_before =
            primary_fungible_store::balance(vault_addr, vusd_metadata());
        assert!(vault_bal_before > 0, 1700);

        case_vault::owner_emergency_drain(deployer, 1, dest);
        assert!(case_vault::state(vault_addr) == case_vault::state_invalid(), 1701);
        let vault_bal_after =
            primary_fungible_store::balance(vault_addr, vusd_metadata());
        assert!(vault_bal_after == 0, 1702);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 7, location = basement::case_vault)]
    fun test_18_drain_bad_destination_aborts(
        aptos_framework: &signer,
        deployer: &signer,
    ) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        case_vault::owner_emergency_drain(deployer, 1, @0xDEAD);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    #[expected_failure(abort_code = 2, location = basement::case_vault)]
    fun test_19_buy_after_drain_aborts(
        aptos_framework: &signer,
        deployer: &signer,
    ) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);
        let dest = signer::address_of(deployer);
        case_vault::owner_emergency_drain(deployer, 1, dest);

        let user_addr = @0xAD;
        let user = make_user(user_addr);
        fund_user(deployer, user_addr, 10_000_000);
        case_vault::buy_yes(&user, 1, 10_000_000, 1);
    }

    #[test(aptos_framework = @aptos_framework, deployer = @basement)]
    fun test_20_cpmm_price_impact_monotonic(
        aptos_framework: &signer,
        deployer: &signer,
    ) {
        setup_env(aptos_framework, deployer);
        init_case_seeded(deployer, 1, 1_000_000);

        let vault_addr = case_vault::vault_address_for(@basement, 1);
        let yes_md = case_vault::yes_metadata(vault_addr);

        let u1_addr = @0xB1;
        let u1 = make_user(u1_addr);
        fund_user(deployer, u1_addr, 10_000_000);
        case_vault::buy_yes(&u1, 1, 10_000_000, 1);
        let s1 = primary_fungible_store::balance(u1_addr, yes_md);

        let u2_addr = @0xB2;
        let u2 = make_user(u2_addr);
        fund_user(deployer, u2_addr, 10_000_000);
        case_vault::buy_yes(&u2, 1, 10_000_000, 1);
        let s2 = primary_fungible_store::balance(u2_addr, yes_md);

        // Second buyer at same vUSD amount should get strictly fewer shares
        // because YES reserve dropped after the first buy.
        assert!(s2 < s1, 2000);
    }

    // Silence unused warnings
    #[test_only]
    fun dummy_use_vec(): vector<u8> { vector::empty<u8>() }
}
