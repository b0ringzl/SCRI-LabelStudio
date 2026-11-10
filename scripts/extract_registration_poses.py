"""Extract re-importable per-image poses from a SCRI annotation export."""
import argparse
import json
import math
from pathlib import Path


def extract_poses(data):
    if not isinstance(data, dict) or data.get('schemaVersion') != '0.2':
        raise ValueError('Expected a SCRI schemaVersion 0.2 annotation export')
    frames, poses = data.get('frames'), data.get('frameRegistrations')
    if not isinstance(frames, list) or not frames or not isinstance(poses, dict):
        raise ValueError('Export must contain frames and frameRegistrations')
    result, names, ids = [], set(), set()
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError('Invalid frame entry')
        frame_id, name = frame.get('id'), frame.get('name')
        if not isinstance(frame_id, str) or not frame_id or frame_id in ids:
            raise ValueError('Missing or duplicate frame id')
        if not isinstance(name, str) or not name or '/' in name or '\\' in name or name.casefold() in names:
            raise ValueError('Missing, duplicate or non-basename image filename')
        ids.add(frame_id)
        names.add(name.casefold())
        pose = poses.get(frame_id)
        if not isinstance(pose, dict):
            raise ValueError(f'Missing independent pose for {name}; not substituting a zero pose')
        clean = {}
        for field in ('position', 'rotation'):
            values = pose.get(field)
            if not isinstance(values, list) or len(values) != 3 or any(
                isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in values
            ):
                raise ValueError(f'Invalid {field} for {name}')
            clean[field] = list(values)
        entry = {'image': name, 'registration': clean}
        time = frame.get('utcSeconds')
        if time is not None:
            if isinstance(time, bool) or not isinstance(time, (int, float)) or not math.isfinite(time):
                raise ValueError(f'Invalid utcSeconds for {name}')
            entry['utcSeconds'] = time
        result.append(entry)
    return {'schemaVersion': 'registration/1.0', 'frames': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', type=Path, help='schemaVersion 0.2 annotation export')
    parser.add_argument('--output', required=True, type=Path, help='New pose JSON; must not exist')
    args = parser.parse_args()
    try:
        output = extract_poses(json.loads(args.export.read_text(encoding='utf-8-sig')))
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(output, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Cannot extract poses: {error}\n')
    print(f'Extracted {len(output["frames"])} poses to {args.output}')


if __name__ == '__main__':
    main()
