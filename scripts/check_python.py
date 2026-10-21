"""Read-only Python syntax/dependency checks; never import main or open the DB."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(architecture=False):
    files = sorted(ROOT.glob("*.py"))
    allowed = json.loads((ROOT / "quality/python-boundaries.json").read_text(encoding="utf-8"))
    modules = {path.stem for path in files}
    graph = {}
    errors = []
    hashes = {}
    paths = files if architecture else files + sorted((ROOT / "tests").glob("*.py")) + sorted((ROOT / "scripts").glob("*.py"))
    for path in paths:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        except SyntaxError as exc:
            errors.append(str(exc))
            continue
        if not architecture:
            continue
        module = path.stem
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes:
            errors.append(f"Duplicate Python module: {path.name} / {hashes[digest]}")
        hashes[digest] = path.name
        if module not in allowed:
            errors.append(f"New module needs architecture/spec review: {path.name}")
        dependencies = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                dependencies.update(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                dependencies.add(node.module.split('.')[0])
        graph[module] = dependencies & modules
        for target in sorted(graph[module] - set(allowed.get(module, []))):
            errors.append(f"Forbidden dependency: {module} -> {target}")
    if architecture:
        visited = set()
        active = []

        def visit(module):
            if module in active:
                errors.append("Circular dependency: " + " -> ".join(active + [module]))
                return
            if module in visited:
                return
            active.append(module)
            for target in sorted(graph.get(module, [])):
                visit(target)
            active.pop()
            visited.add(module)

        for module in sorted(graph):
            visit(module)
        for stale in sorted(set(allowed) - modules):
            errors.append(f"Stale architecture entry: {stale}")
    for error in errors:
        print(error)
    print(f"Python {'architecture' if architecture else 'syntax'}: {len(paths)} files, {len(errors)} errors.")
    return bool(errors)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--syntax", action="store_true")
    parser.add_argument("--architecture", action="store_true")
    args = parser.parse_args()
    raise SystemExit(check(architecture=args.architecture))
