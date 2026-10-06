"""Build the offline synonym index from NLM's unmodified descriptor XML.

Usage: python3 scripts/build-mesh-concepts.py /tmp/desc2026.xml
Source: https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.zip
Do not group all terms of a Descriptor: its Concepts can have different meanings.
"""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

source = Path(sys.argv[1])
concepts = []
for _, element in ET.iterparse(source, events=("end",)):
    if element.tag != "DescriptorRecord":
        continue
    for concept in element.findall("ConceptList/Concept"):
        terms = sorted({term.findtext("String") for term in concept.findall("TermList/Term") if term.findtext("String")})
        # Single-term concepts are included so known distinct concepts remain distinguishable.
        concepts.append([concept.findtext("ConceptUI"), terms])
    element.clear()
output = {
    "source": "NLM MeSH",
    "year": 2026,
    "url": "https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.zip",
    "xmlSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "concepts": sorted(concepts),
}
target = Path("src/features/flashcard/data/mesh-concepts.json")
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"{len(concepts)} concepts, {sum(len(terms) for _, terms in concepts)} terms, {target.stat().st_size} bytes")
