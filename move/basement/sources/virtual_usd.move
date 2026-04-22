/// basement::virtual_usd
///
/// Self-issued "vUSD" Fungible Asset used across Basement v0 testnet.
///
/// Design:
/// - FA metadata lives in a named object derived from the publisher address
///   with seed b"virtual_usd_metadata". All mint/burn capability refs are
///   stored inside that object (NOT at the admin address), and the admin
///   reaches them by reconstructing the object signer via `ExtendRef`.
/// - `init_module` is invoked once by the Aptos framework at publish time.
/// - `admin_mint` is an admin-gated entry; `claim_faucet` is user-callable
///   with a 24h per-address cooldown, and is the sponsored-tx target.
/// - No internal ledger. User balance == their primary fungible store balance.
module basement::virtual_usd {
    use std::option;
    use std::signer;
    use std::string;

    use aptos_framework::event;
    use aptos_framework::fungible_asset::{Self, BurnRef, MintRef};
    use aptos_framework::object::{Self, ExtendRef};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    /// Caller is not the stored admin.
    const E_NOT_ADMIN: u64 = 1;
    /// Module has already been initialized.
    const E_ALREADY_INITIALIZED: u64 = 2;
    /// Faucet called again before the 24h cooldown elapsed.
    const E_FAUCET_COOLDOWN: u64 = 3;
    /// Amount supplied was zero.
    const E_ZERO_AMOUNT: u64 = 4;
    /// Module not initialized yet.
    const E_NOT_INITIALIZED: u64 = 5;

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    /// Deterministic seed for `object::create_named_object` so the FA
    /// metadata address is derivable off-chain.
    const METADATA_SEED: vector<u8> = b"virtual_usd_metadata";

    /// vUSD has 6 decimals, matching USDC convention.
    const DECIMALS: u8 = 6;

    /// Faucet drip = 50 vUSD = 50 * 10^6.
    const FAUCET_AMOUNT: u64 = 50_000_000;

    /// 24h cooldown in seconds.
    const FAUCET_COOLDOWN_SECS: u64 = 86_400;

    // ------------------------------------------------------------------
    // Resources
    // ------------------------------------------------------------------

    /// Lives at the metadata object address. Holds all capability refs
    /// and records the admin address captured at `init_module` time.
    struct VirtualUsdMeta has key {
        admin: address,
        mint_ref: MintRef,
        burn_ref: BurnRef,
        extend_ref: ExtendRef,
    }

    /// Lives at each user address that has claimed the faucet at least
    /// once. Updated in place on subsequent claims.
    struct FaucetClaim has key {
        last_claimed_sec: u64,
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    #[event]
    struct MintedEvent has drop, store {
        to: address,
        amount: u64,
        minter: address,
    }

    #[event]
    struct FaucetClaimedEvent has drop, store {
        user: address,
        amount: u64,
        timestamp: u64,
    }

    // Reserved for future burn flows; declared now so downstream
    // indexers can register the schema early.
    #[event]
    struct FaBurnedEvent has drop, store {
        from: address,
        amount: u64,
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    /// Auto-invoked once by the Aptos framework when the package is
    /// published. `deployer` is the publisher's signer.
    fun init_module(deployer: &signer) {
        let admin_addr = signer::address_of(deployer);
        let expected_meta_addr =
            object::create_object_address(&admin_addr, METADATA_SEED);
        assert!(
            !exists<VirtualUsdMeta>(expected_meta_addr),
            E_ALREADY_INITIALIZED
        );

        let constructor_ref = object::create_named_object(deployer, METADATA_SEED);

        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &constructor_ref,
            option::none(), // unlimited max supply (v0 testnet)
            string::utf8(b"Basement Virtual USD"),
            string::utf8(b"vUSD"),
            DECIMALS,
            string::utf8(b""),
            string::utf8(b""),
        );

        let mint_ref = fungible_asset::generate_mint_ref(&constructor_ref);
        let burn_ref = fungible_asset::generate_burn_ref(&constructor_ref);
        let extend_ref = object::generate_extend_ref(&constructor_ref);

        let object_signer = object::generate_signer(&constructor_ref);
        move_to(
            &object_signer,
            VirtualUsdMeta {
                admin: admin_addr,
                mint_ref,
                burn_ref,
                extend_ref,
            }
        );
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    // Deterministic metadata object address derived from the published
    // `basement` address.
    #[view]
    public fun get_metadata_address(): address {
        object::create_object_address(&@basement, METADATA_SEED)
    }

    #[view]
    public fun admin(): address acquires VirtualUsdMeta {
        let meta_addr = get_metadata_address();
        assert!(exists<VirtualUsdMeta>(meta_addr), E_NOT_INITIALIZED);
        borrow_global<VirtualUsdMeta>(meta_addr).admin
    }

    #[view]
    public fun is_initialized(): bool {
        exists<VirtualUsdMeta>(get_metadata_address())
    }

    #[view]
    public fun last_claimed_sec(user: address): u64 acquires FaucetClaim {
        if (exists<FaucetClaim>(user)) {
            borrow_global<FaucetClaim>(user).last_claimed_sec
        } else {
            0
        }
    }

    // ------------------------------------------------------------------
    // Admin entry
    // ------------------------------------------------------------------

    /// Admin-gated mint. Routes through the MintRef stored inside the
    /// metadata object.
    public entry fun admin_mint(
        admin: &signer,
        to: address,
        amount: u64,
    ) acquires VirtualUsdMeta {
        assert!(amount > 0, E_ZERO_AMOUNT);
        let meta_addr = get_metadata_address();
        assert!(exists<VirtualUsdMeta>(meta_addr), E_NOT_INITIALIZED);

        let meta = borrow_global<VirtualUsdMeta>(meta_addr);
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == meta.admin, E_NOT_ADMIN);

        primary_fungible_store::mint(&meta.mint_ref, to, amount);

        event::emit(
            MintedEvent {
                to,
                amount,
                minter: admin_addr,
            }
        );
    }

    // ------------------------------------------------------------------
    // User entry: sponsored faucet
    // ------------------------------------------------------------------

    /// 24h-cooldown faucet. Drips 50 vUSD to the caller's primary store.
    ///
    /// This is the `fee_payer`-allowlisted target from T4-10: the signer
    /// here is the user; the admin sponsors gas at the framework level,
    /// so we intentionally do NOT take a fee_payer parameter.
    public entry fun claim_faucet(user: &signer) acquires VirtualUsdMeta, FaucetClaim {
        let meta_addr = get_metadata_address();
        assert!(exists<VirtualUsdMeta>(meta_addr), E_NOT_INITIALIZED);

        let user_addr = signer::address_of(user);
        let now = timestamp::now_seconds();

        if (exists<FaucetClaim>(user_addr)) {
            let claim = borrow_global_mut<FaucetClaim>(user_addr);
            assert!(
                now - claim.last_claimed_sec >= FAUCET_COOLDOWN_SECS,
                E_FAUCET_COOLDOWN
            );
            claim.last_claimed_sec = now;
        } else {
            move_to(user, FaucetClaim { last_claimed_sec: now });
        };

        let meta = borrow_global<VirtualUsdMeta>(meta_addr);
        primary_fungible_store::mint(&meta.mint_ref, user_addr, FAUCET_AMOUNT);

        event::emit(
            FaucetClaimedEvent {
                user: user_addr,
                amount: FAUCET_AMOUNT,
                timestamp: now,
            }
        );
    }

    // ------------------------------------------------------------------
    // Test-only helpers
    // ------------------------------------------------------------------

    #[test_only]
    public fun init_for_test(deployer: &signer) {
        init_module(deployer);
    }
}
