"""Focused checks for release provenance and stale document detection."""

import copy
import importlib.util
import json
import subprocess
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
                if (record.ROOT / path).is_file():
                    continue
                # Retired modules remain valid historical references at their release.
                result = subprocess.run(
                    ["git", "cat-file", "-e", f"{release['application_commit']}:{path}"],
                    cwd=record.ROOT, capture_output=True,
                )
                self.assertEqual(result.returncode, 0, path)

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
            # Verify the saved styles used by both body text and bold CJK labels.
            # Visual rendering remains necessary to confirm actual glyph coverage.
            doc = record.Document(first)
            for name in ("Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3", "Table Text", "Reference"):
                style = doc.styles[name]
                self.assertEqual(style.font.name, "Arial", name)
                self.assertEqual(style.element.rPr.rFonts.get(record.qn("w:eastAsia")), "Microsoft YaHei", name)
            with self.assertRaisesRegex(ValueError, "stale"):
                record.check(first, self.data, "changed-source")

    def test_fingerprint_sources_have_checkout_stable_line_endings(self):
        for source in (record.SOURCE, Path(record.__file__)):
            self.assertNotIn(b"\r\n", source.read_bytes(), str(source))


if __name__ == "__main__":
    unittest.main()
