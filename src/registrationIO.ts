import { parsePose } from './registrationMath';
import type { Registration } from './types';

export interface ImportedFramePose { registration: Registration; utcSeconds?: number }

export function parseCalibrationDocument(value: unknown, imageNames: string[]): { frames: Record<string, ImportedFramePose>; warning?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配准 JSON 必须是对象');
  const data = value as Record<string, unknown>;
  const frames: Record<string, ImportedFramePose> = {};
  const lookup = new Map(imageNames.map((name) => [name.toLowerCase(), name]));
  if (Array.isArray(data.frames)) {
    for (const entry of data.frames) {
      if (!entry || typeof entry !== 'object') throw new Error('frames 中存在无效记录');
      const frame = entry as Record<string, unknown>;
      const image = typeof frame.image === 'string' ? lookup.get(frame.image.toLowerCase()) : undefined;
      if (!image) throw new Error(`位姿记录的影像未被选中：${String(frame.image)}`);
      if (frames[image]) throw new Error(`重复的影像位姿：${image}`);
      if (frame.utcSeconds !== undefined && (typeof frame.utcSeconds !== 'number' || !Number.isFinite(frame.utcSeconds)))
        throw new Error(`无效的 UTC 秒数：${image}`);
      const hardware = data.hardware && typeof data.hardware === 'object' ? data.hardware as Record<string, unknown> : {};
      const pose = frame.bodyToCloud && hardware.cameraToBody
        ? { bodyToCloud: frame.bodyToCloud, cameraToBody: hardware.cameraToBody }
        : frame;
      frames[image] = { registration: parsePose(pose),
        utcSeconds: typeof frame.utcSeconds === 'number' && Number.isFinite(frame.utcSeconds) ? frame.utcSeconds : undefined };
    }
    if (!Object.keys(frames).length) throw new Error('frames 不能为空');
    return { frames, warning: Object.keys(frames).length < imageNames.length ? '部分影像缺少位姿，不能参与多视角定位' : undefined };
  }
  const pose = parsePose(data);
  frames[imageNames[0]] = { registration: pose };
  return { frames, warning: imageNames.length > 1 ? '单个位姿只分配给首帧；其他影像须导入逐帧位姿' : undefined };
}
