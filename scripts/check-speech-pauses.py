"""Check real Android TTS request timing (fixture audio itself lasts 200 ms)."""
import re
import sys
from pathlib import Path

events = re.findall(r"speech@(\d+)\|(?:zh|zho)\|([^\r\n]+)", Path(sys.argv[1]).read_text())
for label, meaning in [("名词", "名称"), ("副词", "快速地")]:
    gaps = [int(end) - int(start) for (start, first), (end, second) in zip(events, events[1:])
            if first.strip() == label and second.strip() == meaning]
    assert gaps, f"No completed {label} → {meaning} speech pair"
    assert min(gaps) >= 350, f"Missing pause after {label}: {gaps}"
    print(f"{label} → {meaning}: {len(gaps)} pairs, minimum request interval {min(gaps)} ms")
