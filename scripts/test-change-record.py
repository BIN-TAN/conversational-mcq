"""Focused checks for release provenance and stale document detection."""

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("change_record", Path(__file__).with_name("build-change-record.py"))
record = importlib.util.module_from_spec(spec)
spec.loader.exec_module(record)


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.raw = record.SOURCE.read_bytes()
        self.data = json.loads(self.raw)

    def test_valid_ledger(self):
        record.validate(self.data)

    def test_referenced_repository_files_exist(self):
        for release in self.data["releases"]:
            for path in release["references"]:
                self.assertTrue((record.ROOT / path).is_file(), path)

    def test_duplicate_release_rejected(self):
        self.data["releases"].append(copy.deepcopy(self.data["releases"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            record.validate(self.data)

    def test_wrong_deployed_commit_rejected(self):
        self.data["releases"][0]["deployment"]["source_commit"] = "0" * 40
        with self.assertRaisesRegex(ValueError, "must match"):
            record.validate(self.data)

    def test_live_without_evidence_rejected(self):
        del self.data["releases"][0]["deployment"]["evidence"]
        with self.assertRaisesRegex(ValueError, "missing evidence"):
            record.validate(self.data)

    def test_deterministic_output_and_staleness(self):
        identity = record.fingerprint(self.raw)
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.docx"
            second = Path(directory) / "second.docx"
            record.build(self.data, identity, first)
            record.build(self.data, identity, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            record.check(first, self.data, identity)
            with self.assertRaisesRegex(ValueError, "stale"):
                record.check(first, self.data, "changed-source")


if __name__ == "__main__":
    unittest.main()
