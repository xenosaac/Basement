/// basement::oracle — thin adapter around Pyth's on-chain PriceFeed API.
///
/// v0 assumptions (DO NOT REMOVE without review):
/// - All feeds used (BTC/USD, ETH/USD) have exponent = -8 (crypto convention).
///   Oracle does NOT dynamically rescale for exponent in v0. Callers must
///   interpret returned `price_u64_abs` as a fixed-point value with 8 decimals.
/// - Prices are never cached in module state — every read delegates to Pyth.
/// - Negative Pyth prices are rejected (crypto feeds are non-negative in practice).
/// - `update_price_feeds` is permissionless: any signer may invoke it and pays
///   the Pyth fee in APT from their own account. No admin gate, no subsidy,
///   no fee cap — pure passthrough.
module basement::oracle {
    use std::vector;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;
    use pyth::pyth;
    use pyth::price_identifier::{Self, PriceIdentifier};
    use pyth::price::{Self, Price};
    use pyth::i64;

    // ---------- Abort codes ----------
    const E_STALE: u64 = 1;
    const E_NEGATIVE_PRICE: u64 = 2;
    const E_INVALID_FEED: u64 = 3;
    const E_INSUFFICIENT_FEE: u64 = 4;
    const E_INVALID_THRESHOLD: u64 = 5;

    // ---------- Threshold types ----------
    const THRESHOLD_ABOVE: u8 = 0;
    const THRESHOLD_BELOW: u8 = 1;
    const THRESHOLD_EQ_ROUNDED: u8 = 2;

    // ---------- Outcome codes ----------
    const OUTCOME_YES: u8 = 0;
    const OUTCOME_NO: u8 = 1;

    /// Latest price without staleness check.
    /// Returns (price_u64_abs, confidence, publish_time).
    /// Aborts with E_NEGATIVE_PRICE if the Pyth price is negative.
    #[view]
    public fun get_price(price_id_bytes: vector<u8>): (u64, u64, u64) {
        let price_id = price_identifier::from_byte_vec(price_id_bytes);
        let p: Price = pyth::get_price(price_id);
        let raw = price::get_price(&p);
        assert!(!i64::get_is_negative(&raw), E_NEGATIVE_PRICE);
        let mag = i64::get_magnitude_if_positive(&raw);
        (mag, price::get_conf(&p), price::get_timestamp(&p))
    }

    /// Latest price with staleness guard. Pyth aborts internally if older
    /// than `max_staleness_sec`.
    /// Returns (price_u64_abs, confidence, publish_time).
    #[view]
    public fun get_price_no_older_than(
        price_id_bytes: vector<u8>,
        max_staleness_sec: u64
    ): (u64, u64, u64) {
        let price_id = price_identifier::from_byte_vec(price_id_bytes);
        let p: Price = pyth::get_price_no_older_than(price_id, max_staleness_sec);
        let raw = price::get_price(&p);
        assert!(!i64::get_is_negative(&raw), E_NEGATIVE_PRICE);
        let mag = i64::get_magnitude_if_positive(&raw);
        (mag, price::get_conf(&p), price::get_timestamp(&p))
    }

    /// Permissionless Pyth price feed update. User pays the Pyth fee in APT.
    /// `vaa_bytes` is a single Wormhole VAA produced by the Pyth Hermes API.
    public entry fun update_price_feeds(user: &signer, vaa_bytes: vector<u8>) {
        let update_data = vector::empty<vector<u8>>();
        vector::push_back(&mut update_data, vaa_bytes);
        let fee = pyth::get_update_fee(&update_data);
        let coins = coin::withdraw<AptosCoin>(user, fee);
        // NOTE: pyth::update_price_feeds signature is (vaas, fee).
        pyth::update_price_feeds(update_data, coins);
    }

    /// Pure outcome calculator.
    /// - threshold_type = 0 (ABOVE): YES iff price > strike
    /// - threshold_type = 1 (BELOW): YES iff price < strike
    /// - threshold_type = 2 (EQ_ROUNDED): always NO in v0 stub
    ///   TODO: v1 implement EQ_ROUNDED bucket compare
    /// Aborts with E_INVALID_THRESHOLD for any other value.
    public fun compute_outcome(
        price_u64: u64,
        strike_price_u64: u64,
        threshold_type: u8
    ): u8 {
        if (threshold_type == THRESHOLD_ABOVE) {
            if (price_u64 > strike_price_u64) OUTCOME_YES else OUTCOME_NO
        } else if (threshold_type == THRESHOLD_BELOW) {
            if (price_u64 < strike_price_u64) OUTCOME_YES else OUTCOME_NO
        } else if (threshold_type == THRESHOLD_EQ_ROUNDED) {
            // TODO: v1 implement EQ_ROUNDED bucket compare
            OUTCOME_NO
        } else {
            abort E_INVALID_THRESHOLD
        }
    }

    // ---------- Test-only accessors for abort codes ----------
    #[test_only]
    public fun e_invalid_threshold(): u64 { E_INVALID_THRESHOLD }
    #[test_only]
    public fun e_negative_price(): u64 { E_NEGATIVE_PRICE }
}
