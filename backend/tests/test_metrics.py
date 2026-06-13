"""Unit tests for the in-memory conversion metrics collector.

Covers recording of successful/failed conversions, average processing time
computation, thread-safety under concurrent recording, and snapshot
immutability.

Requirements: 15.1, 15.4
"""

import threading

from app.services.metrics import MetricsCollector, MetricsSnapshot


def test_empty_collector_snapshot_has_zero_metrics():
    collector = MetricsCollector()
    snap = collector.snapshot()

    assert snap.total_conversions == 0
    assert snap.successful_conversions == 0
    assert snap.failed_conversions == 0
    assert snap.average_processing_time_seconds == 0.0
    assert snap.total_processing_time_seconds == 0.0


def test_records_successful_conversion():
    collector = MetricsCollector()
    collector.record_conversion(success=True, processing_time=2.0)

    snap = collector.snapshot()
    assert snap.total_conversions == 1
    assert snap.successful_conversions == 1
    assert snap.failed_conversions == 0
    assert snap.average_processing_time_seconds == 2.0


def test_records_failed_conversion():
    collector = MetricsCollector()
    collector.record_conversion(success=False, processing_time=1.5)

    snap = collector.snapshot()
    assert snap.total_conversions == 1
    assert snap.successful_conversions == 0
    assert snap.failed_conversions == 1
    assert snap.average_processing_time_seconds == 1.5


def test_average_processing_time_across_multiple_conversions():
    collector = MetricsCollector()
    collector.record_conversion(success=True, processing_time=1.0)
    collector.record_conversion(success=True, processing_time=2.0)
    collector.record_conversion(success=False, processing_time=3.0)

    snap = collector.snapshot()
    assert snap.total_conversions == 3
    assert snap.successful_conversions == 2
    assert snap.failed_conversions == 1
    # (1 + 2 + 3) / 3 == 2.0
    assert snap.average_processing_time_seconds == 2.0
    assert snap.total_processing_time_seconds == 6.0


def test_negative_processing_time_is_clamped_to_zero():
    collector = MetricsCollector()
    collector.record_conversion(success=True, processing_time=-5.0)

    snap = collector.snapshot()
    assert snap.total_processing_time_seconds == 0.0
    assert snap.average_processing_time_seconds == 0.0


def test_reset_clears_all_counters():
    collector = MetricsCollector()
    collector.record_conversion(success=True, processing_time=1.0)
    collector.record_conversion(success=False, processing_time=2.0)

    collector.reset()

    snap = collector.snapshot()
    assert snap.total_conversions == 0
    assert snap.successful_conversions == 0
    assert snap.failed_conversions == 0
    assert snap.average_processing_time_seconds == 0.0


def test_snapshot_is_immutable():
    collector = MetricsCollector()
    snap = collector.snapshot()
    assert isinstance(snap, MetricsSnapshot)

    # Frozen dataclass: mutation should raise.
    import dataclasses

    try:
        snap.total_conversions = 99  # type: ignore[misc]
        raised = False
    except dataclasses.FrozenInstanceError:
        raised = True
    assert raised


def test_concurrent_recording_is_thread_safe():
    collector = MetricsCollector()
    iterations = 1000
    threads_count = 8

    def worker():
        for _ in range(iterations):
            collector.record_conversion(success=True, processing_time=1.0)

    threads = [threading.Thread(target=worker) for _ in range(threads_count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    snap = collector.snapshot()
    expected = iterations * threads_count
    assert snap.total_conversions == expected
    assert snap.successful_conversions == expected
    assert snap.failed_conversions == 0
    assert snap.average_processing_time_seconds == 1.0
