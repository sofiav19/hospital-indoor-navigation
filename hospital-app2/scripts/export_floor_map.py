from __future__ import annotations
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROLE_STYLES = {
    "door": {
        "offset_x": 12,
        "offset_y": -10,
        "rotate": 0,
        "size_stops": [(18, 0.06), (20, 0.10), (22, 0.16), (24, 0.16)],
    },
    "doors": {
        "offset_x": 8,
        "offset_y": 0,
        "rotate": 0,
        "size_stops": [(18, 0.01), (20, 0.01), (22, 0.06), (24, 0.14)],
    },
    "stairs": {
        "offset_x": 2,
        "offset_y": -15,
        "rotate": 0,
        "size_stops": [(18, 0.00), (20, 0.04), (22, 0.08), (24, 0.09)],
    },
    "elevator": {
        "offset_x": -10,
        "offset_y": 0,
        "rotate": 0,
        "size_stops": [(18, 0.01), (20, 0.03), (22, 0.07), (24, 0.13)],
    },
}

ICON_META = {
    "door": {"width": 164, "height": 141},
    "doors": {"width": 471, "height": 244},
    "stairs": {"width": 562, "height": 563},
    "elevator": {"width": 422, "height": 609},
}

ICON_FILES = {
    "door": "door.png",
    "doors": "doors.png",
    "stairs": "stairs.png",
    "elevator": "elevator.png",
}

def interpolate_stops(stops, value):
    if value <= stops[0][0]:
        return stops[0][1]
    if value >= stops[-1][0]:
        return stops[-1][1]

    for index in range(1, len(stops)):
        x1, y1 = stops[index - 1]
        x2, y2 = stops[index]
        if value <= x2:
            t = (value - x1) / (x2 - x1)
            return y1 + (y2 - y1) * t

    return stops[-1][1]

def parse_args():
    parser = argparse.ArgumentParser(description="Export a floor map PNG with icons.")
    parser.add_argument("--floor", type=int, default=0)
    parser.add_argument("--width", type=int, default=880)
    parser.add_argument("--height", type=int, default=420)
    parser.add_argument("--padding", type=int, default=24)
    parser.add_argument("--zoom", type=float, default=22)
    parser.add_argument("--out-file", default="")
    return parser.parse_args()

def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def get_floor_features(collection, floor):
    return [feature for feature in collection["features"] if feature["properties"].get("floor") == floor]

def get_projector(args, floorplan_features, node_features):
    all_coords = []
    for feature in floorplan_features:
        for polygon in feature["geometry"]["coordinates"]:
            for ring in polygon:
                all_coords.extend(ring)
    for feature in node_features:
        all_coords.append(feature["geometry"]["coordinates"])

    if not all_coords:
        raise RuntimeError(f"No features found for floor {args.floor}.")

    xs = [float(coord[0]) for coord in all_coords]
    ys = [float(coord[1]) for coord in all_coords]
    min_x, max_x = min(xs), max(xs)
    max_y = max(ys)
    data_width = max(1.0, max_x - min_x)
    data_height = max(1.0, max_y - min(ys))
    usable_width = max(1.0, args.width - 2 * args.padding)
    usable_height = max(1.0, args.height - 2 * args.padding)
    scale = min(usable_width / data_width, usable_height / data_height)
    offset_x = (args.width - data_width * scale) / 2.0
    offset_y = (args.height - data_height * scale) / 2.0

    def project_point(coord):
        px = offset_x + (float(coord[0]) - min_x) * scale
        py = offset_y + (max_y - float(coord[1])) * scale
        return px, py

    return project_point


def draw_floorplan(draw, floorplan_features, project_point):
    fill_color = (216, 238, 242, 255)
    outline_color = (23, 52, 60, 255)
    for feature in floorplan_features:
        for polygon in feature["geometry"]["coordinates"]:
            for ring in polygon:
                points = [project_point(coord) for coord in ring]
                if len(points) >= 3:
                    draw.polygon(points, fill=fill_color, outline=outline_color)


def draw_icons(image, root, overrides, floor, zoom, node_features, project_point):
    icons = {role: Image.open(root / "assets" / "icons" / filename).convert("RGBA") for role, filename in ICON_FILES.items()}

    for feature in node_features:
        role = str(feature["properties"].get("role"))
        if role not in ROLE_STYLES:
            continue

        style = ROLE_STYLES[role]
        meta = ICON_META[role]
        override = overrides.get(str(floor), {}).get(str(feature["properties"].get("id")), {})
        projected_x, projected_y = project_point(feature["geometry"]["coordinates"])
        size = interpolate_stops(style["size_stops"], zoom)
        scale_override = float(override.get("scale", 1.0))
        dx = float(override.get("dx", 0))
        dy = float(override.get("dy", 0))
        rotate_override = float(override.get("rotate", 0))
        angle = float(feature["properties"].get("angle", 0.0) or 0.0)
        rotation = angle + float(style["rotate"]) + rotate_override
        icon_width = max(1, round(meta["width"] * size * scale_override))
        icon_height = max(1, round(meta["height"] * size * scale_override))
        center_x = projected_x + float(style["offset_x"]) + dx
        center_y = projected_y + float(style["offset_y"]) + dy
        resized = icons[role].resize((icon_width, icon_height), Image.Resampling.LANCZOS)
        rotated = resized.rotate(-rotation, expand=True, resample=Image.Resampling.BICUBIC)
        image.alpha_composite(rotated, (round(center_x - rotated.width / 2), round(center_y - rotated.height / 2)))


def main():
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    root = script_dir.parent
    floorplan = load_json(root / "assets" / "data" / "floorplan_c.json")
    nodes = load_json(root / "assets" / "data" / "nodes_hospital.json")
    overrides = load_json(script_dir / "floormap_override.json")
    out_file = Path(args.out_file) if args.out_file else root / "exports" / f"floor-{args.floor}-map-{args.width}x{args.height}.png"
    floorplan_features = get_floor_features(floorplan, args.floor)
    node_features = get_floor_features(nodes, args.floor)
    project_point = get_projector(args, floorplan_features, node_features)

    image = Image.new("RGBA", (args.width, args.height), (247, 251, 252, 255))
    draw = ImageDraw.Draw(image)
    draw_floorplan(draw, floorplan_features, project_point)
    draw_icons(image, root, overrides, args.floor, args.zoom, node_features, project_point)

    out_file.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_file, format="PNG")
    print(f"Exported PNG to {out_file}")

if __name__ == "__main__":
    main()
