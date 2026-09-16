"""Sondaj: exista campiile Europei deja marcate ca poligoane in OSM?"""
import json
import requests

Q = """
[out:json][timeout:180];
(
  way["natural"="plain"](34,-12,72,60);
  relation["natural"="plain"](34,-12,72,60);
  way["place"="plain"](34,-12,72,60);
  relation["place"="plain"](34,-12,72,60);
  way["natural"="lowland"](34,-12,72,60);
  relation["natural"="lowland"](34,-12,72,60);
);
out tags center;
"""

r = requests.post("https://overpass-api.de/api/interpreter", data={"data": Q}, timeout=200)
r.raise_for_status()
d = r.json()
els = d.get("elements", [])
print("total elemente natural/place=plain in Europa:", len(els))

named = [e for e in els if (e.get("tags") or {}).get("name")]
print("cu nume:", len(named))
print("relatii (poligon mare):", sum(1 for e in els if e["type"] == "relation"))
print()
for e in named[:60]:
    t = e["tags"]
    print("  %-9s %-11s %-40s %s" % (e["type"], e["id"], t.get("name", "")[:40],
                                     t.get("natural") or t.get("place")))

json.dump(d, open("_probe_plain.json", "w", encoding="utf-8"), ensure_ascii=False)
