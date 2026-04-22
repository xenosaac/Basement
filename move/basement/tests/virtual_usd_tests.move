#[test_only]
module basement::virtual_usd_tests {
    use std::signer;

    use aptos_framework::account;
    use aptos_framework::fungible_asset;
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;

    use basement::virtual_usd;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fun setup_time(aptos_framework: &signer) {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        // Start clock at a non-zero epoch so underflow guards are safe.
        timestamp::update_global_time_for_test_secs(1_700_000_000);
    }

    fun metadata_object(): Object<fungible_asset::Metadata> {
        object::address_to_object<fungible_asset::Metadata>(
            virtual_usd::get_metadata_address()
        )
    }

    fun balance_of(owner: address): u64 {
        primary_fungible_store::balance(owner, metadata_object())
    }

    // ------------------------------------------------------------------
    // Tests
    // ------------------------------------------------------------------

    #[test(aptos_framework = @aptos_framework, admin = @basement)]
    fun test_init_module_happy_path(aptos_framework: &signer, admin: &signer) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));

        virtual_usd::init_for_test(admin);

        assert!(virtual_usd::is_initialized(), 100);
        assert!(virtual_usd::admin() == signer::address_of(admin), 101);

        let meta_addr = virtual_usd::get_metadata_address();
        let expected = object::create_object_address(
            &signer::address_of(admin),
            b"virtual_usd_metadata"
        );
        assert!(meta_addr == expected, 102);
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement)]
    #[expected_failure(abort_code = 2, location = basement::virtual_usd)]
    fun test_init_module_idempotent(aptos_framework: &signer, admin: &signer) {
        // Re-initializing must abort with E_ALREADY_INITIALIZED (= 2).
        // Our explicit `exists<VirtualUsdMeta>` guard fires before the
        // framework's EOBJECT_EXISTS, so the surfaced code is ours.
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));

        virtual_usd::init_for_test(admin);
        virtual_usd::init_for_test(admin); // should abort
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, user = @0xA11CE)]
    fun test_admin_mint_happy_path(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(user));

        virtual_usd::init_for_test(admin);

        let user_addr = signer::address_of(user);
        virtual_usd::admin_mint(admin, user_addr, 100_000_000); // 100 vUSD

        assert!(balance_of(user_addr) == 100_000_000, 200);
    }

    #[test(
        aptos_framework = @aptos_framework,
        admin = @basement,
        attacker = @0xBADD,
        user = @0xA11CE,
    )]
    #[expected_failure(abort_code = 1, location = basement::virtual_usd)]
    fun test_admin_mint_non_admin_reverts(
        aptos_framework: &signer,
        admin: &signer,
        attacker: &signer,
        user: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(attacker));
        account::create_account_for_test(signer::address_of(user));

        virtual_usd::init_for_test(admin);

        // Non-admin tries to mint → E_NOT_ADMIN (= 1).
        virtual_usd::admin_mint(attacker, signer::address_of(user), 1_000_000);
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, user = @0xA11CE)]
    fun test_claim_faucet_happy_path(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(user));

        virtual_usd::init_for_test(admin);

        let user_addr = signer::address_of(user);
        virtual_usd::claim_faucet(user);

        assert!(balance_of(user_addr) == 50_000_000, 300);
        assert!(
            virtual_usd::last_claimed_sec(user_addr) == timestamp::now_seconds(),
            301
        );
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, user = @0xA11CE)]
    #[expected_failure(abort_code = 3, location = basement::virtual_usd)]
    fun test_claim_faucet_cooldown_reverts(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(user));

        virtual_usd::init_for_test(admin);

        virtual_usd::claim_faucet(user);
        // Advance time by less than the cooldown.
        timestamp::update_global_time_for_test_secs(
            timestamp::now_seconds() + 3_600
        );
        virtual_usd::claim_faucet(user); // aborts E_FAUCET_COOLDOWN (= 3)
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, user = @0xA11CE)]
    fun test_claim_faucet_after_24h_ok(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(user));

        virtual_usd::init_for_test(admin);

        let user_addr = signer::address_of(user);
        virtual_usd::claim_faucet(user);
        assert!(balance_of(user_addr) == 50_000_000, 400);

        timestamp::update_global_time_for_test_secs(
            timestamp::now_seconds() + 86_400
        );
        virtual_usd::claim_faucet(user);
        assert!(balance_of(user_addr) == 100_000_000, 401);
    }

    // Verifies the admin gate blocks an attacker from indirectly using
    // the MintRef through the only mint-capable public entry
    // (`admin_mint`). The MintRef itself is stored inside the metadata
    // object; there is no public API that hands it out.
    #[test(
        aptos_framework = @aptos_framework,
        admin = @basement,
        attacker = @0xBADD,
    )]
    #[expected_failure(abort_code = 1, location = basement::virtual_usd)]
    fun test_mint_ref_isolation(
        aptos_framework: &signer,
        admin: &signer,
        attacker: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(attacker));

        virtual_usd::init_for_test(admin);

        // Attacker attempts to mint to themselves → E_NOT_ADMIN.
        virtual_usd::admin_mint(
            attacker,
            signer::address_of(attacker),
            1_000_000,
        );
    }

    #[test(aptos_framework = @aptos_framework, admin = @basement, user = @0xA11CE)]
    #[expected_failure(abort_code = 4, location = basement::virtual_usd)]
    fun test_admin_mint_zero_amount_reverts(
        aptos_framework: &signer,
        admin: &signer,
        user: &signer,
    ) {
        setup_time(aptos_framework);
        account::create_account_for_test(signer::address_of(admin));
        account::create_account_for_test(signer::address_of(user));

        virtual_usd::init_for_test(admin);

        virtual_usd::admin_mint(admin, signer::address_of(user), 0);
    }
}
