"""Read bounded PCD blocks without silently accepting truncated source files."""
from pathlib import Path
import numpy as np


def header(path):
    result = {}; lines = 0
    with Path(path).open('rb') as f:
        while True:
            raw = f.readline(); lines += 1
            if not raw or lines > 100: raise ValueError('Invalid PCD header')
            line = raw.decode('ascii').strip()
            if not line or line.startswith('#'): continue
            key, _, value = line.partition(' '); result[key] = value.strip()
            if key == 'DATA': result['offset'] = f.tell(); result['lines'] = lines; break
    names = result['FIELDS'].split(); sizes = list(map(int,result['SIZE'].split()))
    types = result['TYPE'].split(); counts = list(map(int,result.get('COUNT',' '.join(['1']*len(names))).split()))
    if len({len(names),len(sizes),len(types),len(counts)}) != 1: raise ValueError('Inconsistent PCD fields')
    kinds={'F':'f','I':'i','U':'u'}
    result['dtype'] = np.dtype([(n, '<'+kinds[t]+str(s)) if c==1 else (n,'<'+kinds[t]+str(s),(c,)) for n,t,s,c in zip(names,types,sizes,counts)])
    result['count'] = int(result['POINTS']); result['columns'] = sum(counts)
    if any(n not in names for n in ('x','y','z')): raise ValueError('PCD requires XYZ fields')
    return result


def open_binary(path):
    path=Path(path); h=header(path)
    if h['DATA'] != 'binary': raise ValueError('Expected binary PCD')
    expected=h['count']*h['dtype'].itemsize; actual=path.stat().st_size-h['offset']
    if actual < expected: raise ValueError(f'Truncated PCD: {path.name}: {actual} < {expected}')
    padding=actual-expected
    if padding:
        if padding > 65536: raise ValueError('Unexpected PCD trailer size')
        with path.open('rb') as f:
            f.seek(h['offset']+expected)
            if f.read().strip(b'\0\r\n\t '): raise ValueError('Unexpected nonzero PCD trailer')
    h['paddingBytes'] = padding
    return np.memmap(path,mode='r',dtype=h['dtype'],offset=h['offset'],shape=(h['count'],)),h


def load_ascii(path):
    h=header(path)
    if h['DATA'] != 'ascii': raise ValueError('Expected ASCII PCD')
    data=np.loadtxt(path,skiprows=h['lines'],dtype=np.float32,ndmin=2)
    if data.shape != (h['count'],h['columns']): raise ValueError(f'ASCII PCD count/columns mismatch: {Path(path).name}')
    return data,h


def xyz(data):
    return np.column_stack([data[n] for n in ('x','y','z')]).astype(np.float64)


def voxel_indices(points, size, budget=None):
    """One original representative per occupied cell; increase resolution size to
    respect a budget, preserving extent instead of discarding a geographic area."""
    size=float(size)
    while True:
        cells=np.floor(points/size).astype(np.int64)
        # Structured views avoid assumptions about the size or sign of coordinates.
        packed=np.ascontiguousarray(cells).view([('x','<i8'),('y','<i8'),('z','<i8')]).reshape(-1)
        _, keep=np.unique(packed,return_index=True)
        if budget is None or len(keep)<=budget: return keep,size
        size *= max(1.1,(len(keep)/budget)**.5)


def write_pcd(path, points, values, field='intensity'):
    count=len(points); dtype=np.dtype([('x','<f4'),('y','<f4'),('z','<f4'),(field,'<u4' if field=='rgb' else '<f4')])
    data=np.empty(count,dtype=dtype)
    for i,n in enumerate(('x','y','z')): data[n]=points[:,i]
    data[field]=values
    h=f'VERSION 0.7\nFIELDS x y z {field}\nSIZE 4 4 4 4\nTYPE F F F '+('U' if field=='rgb' else 'F')+f'\nCOUNT 1 1 1 1\nWIDTH {count}\nHEIGHT 1\nPOINTS {count}\nDATA binary\n'
    with Path(path).open('wb') as f: f.write(h.encode()); f.write(data.tobytes())
