-- ECO event calendar seed (Phase G, 2026-04-24)
-- ============================================================================
-- BLS / BEA macro release schedule for the next 6-12 months. Times in Unix
-- seconds, anchored to the canonical 8:30 AM ET embargo release. Daylight
-- Savings Time handling: 12:30 UTC during EDT (Mar 8 — Nov 1, 2026), 13:30
-- UTC during EST (Nov 2, 2026 — Mar 14, 2027).
--
-- Sources to verify each quarter:
--   - bls.gov/schedule/news_release/cpi.htm    (CPI MoM, Unemployment NFP)
--   - bea.gov/news/schedule                     (Core PCE MoM, GDP QoQ Adv)
--
-- OPS NOTE: refresh quarterly. Approximations encoded here:
--   - CPI MoM: 2nd/3rd week of the month (BLS publishes mid-month)
--   - Core PCE: last Friday of the month (BEA "Personal Income & Outlays")
--   - Unemployment: first Friday of the month (NFP report)
--   - GDP QoQ Advance: ~end of month following quarter end
-- Cross-check actual published dates with the sources above before relying
-- on these timestamps in production. Idempotent via UNIQUE(event_type,
-- release_time_sec).
-- ============================================================================

INSERT INTO eco_event_calendar (event_type, release_time_sec, status) VALUES
  -- US CPI MoM (BLS, ~mid-month 8:30 AM ET)
  ('us_cpi_mom', 1778589000, 'scheduled'),  -- 2026-05-12 12:30 UTC (EDT)
  ('us_cpi_mom', 1781181000, 'scheduled'),  -- 2026-06-11 12:30 UTC
  ('us_cpi_mom', 1784032200, 'scheduled'),  -- 2026-07-14 12:30 UTC
  ('us_cpi_mom', 1786537800, 'scheduled'),  -- 2026-08-12 12:30 UTC
  ('us_cpi_mom', 1789043400, 'scheduled'),  -- 2026-09-10 12:30 UTC
  ('us_cpi_mom', 1791894600, 'scheduled'),  -- 2026-10-13 12:30 UTC
  ('us_cpi_mom', 1794490200, 'scheduled'),  -- 2026-11-12 13:30 UTC (EST)
  ('us_cpi_mom', 1796909400, 'scheduled'),  -- 2026-12-10 13:30 UTC

  -- US Core PCE MoM (BEA, last Friday 8:30 AM ET)
  ('us_core_pce_mom', 1780057800, 'scheduled'),  -- 2026-05-29 12:30 UTC
  ('us_core_pce_mom', 1782477000, 'scheduled'),  -- 2026-06-26 12:30 UTC
  ('us_core_pce_mom', 1785501000, 'scheduled'),  -- 2026-07-31 12:30 UTC
  ('us_core_pce_mom', 1787920200, 'scheduled'),  -- 2026-08-28 12:30 UTC
  ('us_core_pce_mom', 1790339400, 'scheduled'),  -- 2026-09-25 12:30 UTC
  ('us_core_pce_mom', 1793363400, 'scheduled'),  -- 2026-10-30 12:30 UTC

  -- US Unemployment Rate (NFP, first Friday 8:30 AM ET)
  ('us_unemployment', 1777638600, 'scheduled'),  -- 2026-05-01 12:30 UTC
  ('us_unemployment', 1780662600, 'scheduled'),  -- 2026-06-05 12:30 UTC
  ('us_unemployment', 1783081800, 'scheduled'),  -- 2026-07-03 12:30 UTC
  ('us_unemployment', 1786105800, 'scheduled'),  -- 2026-08-07 12:30 UTC
  ('us_unemployment', 1788525000, 'scheduled'),  -- 2026-09-04 12:30 UTC
  ('us_unemployment', 1790944200, 'scheduled'),  -- 2026-10-02 12:30 UTC

  -- US GDP QoQ Advance (BEA, ~end of month following quarter end 8:30 AM ET)
  ('us_gdp_qoq', 1777552200, 'scheduled'),       -- 2026-04-30 12:30 UTC (Q1)
  ('us_gdp_qoq', 1785414600, 'scheduled')        -- 2026-07-30 12:30 UTC (Q2)
ON CONFLICT (event_type, release_time_sec) DO NOTHING;
