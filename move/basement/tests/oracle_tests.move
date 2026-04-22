// Unit tests for basement::oracle::compute_outcome.
//
// Integration tests that exercise `pyth::update_price_feeds`,
// `pyth::get_price`, or `pyth::get_price_no_older_than` require a Pyth
// test harness (Wormhole VAAs + pyth::state initialization) that is not
// worth building in v0. Those paths are covered by devnet/testnet
// integration tests off-chain.
#[test_only]
module basement::oracle_tests {
    use basement::oracle;

    #[test]
    fun test_compute_outcome_above_yes() {
        // price=100, strike=90, ABOVE → YES(0)
        assert!(oracle::compute_outcome(100, 90, 0) == 0, 100);
    }

    #[test]
    fun test_compute_outcome_above_no() {
        // price=80, strike=90, ABOVE → NO(1)
        assert!(oracle::compute_outcome(80, 90, 0) == 1, 101);
    }

    #[test]
    fun test_compute_outcome_above_equal_is_no() {
        // strict > : equal should be NO
        assert!(oracle::compute_outcome(90, 90, 0) == 1, 102);
    }

    #[test]
    fun test_compute_outcome_below_yes() {
        // price=80, strike=90, BELOW → YES(0)
        assert!(oracle::compute_outcome(80, 90, 1) == 0, 110);
    }

    #[test]
    fun test_compute_outcome_below_no() {
        // price=100, strike=90, BELOW → NO(1)
        assert!(oracle::compute_outcome(100, 90, 1) == 1, 111);
    }

    #[test]
    fun test_compute_outcome_eq_rounded_stub() {
        // v0 stub always returns NO regardless of inputs
        assert!(oracle::compute_outcome(100, 100, 2) == 1, 120);
        assert!(oracle::compute_outcome(0, 0, 2) == 1, 121);
        assert!(oracle::compute_outcome(999, 1, 2) == 1, 122);
    }

    #[test]
    #[expected_failure(abort_code = 5, location = basement::oracle)]
    fun test_compute_outcome_invalid_threshold() {
        oracle::compute_outcome(100, 90, 99);
    }
}
