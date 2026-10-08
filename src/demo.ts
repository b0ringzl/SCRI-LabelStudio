import type { Annotation, ClassDefinition, PairTask, Registration } from './types';

export const demoTask: PairTask = {
  id: 'JSZ-001298',
  name: '尖沙咀街景 · 全景帧 001298',
  location: '2025-02-10 尖沙咀 / Ladybug / 站点 001298',
  pointCloudName: 'sample-cloud.pcd',
  panoramaName: 'sample-panorama.jpg',
  pointCloudUrl: '/sample-cloud.pcd',
  panoramaUrl: '/sample-panorama.jpg',
  isDemo: true,
  createdAt: '2025-02-10',
};

export const syntheticDemoTask: PairTask = {
  id: 'ATLAS-SYNTH-001',
  name: '合成建筑街景 · 演示任务',
  location: '可共享合成数据 / 不对应真实地点',
  pointCloudName: 'demo-cloud.pcd',
  panoramaName: 'demo-panorama.png',
  pointCloudUrl: '/demo-cloud.pcd',
  panoramaUrl: '/demo-panorama.png',
  createdAt: '2026-10-08',
};

export const initialClasses: ClassDefinition[] = [
  { id: 'building', name: '建筑立面', color: '#7867e9', shortcut: '1' },
  { id: 'window', name: '门窗', color: '#47b9a6', shortcut: '2' },
  { id: 'column', name: '柱 / 梁', color: '#f0a05a', shortcut: '3' },
  { id: 'sign', name: '标志牌', color: '#ea6d8e', shortcut: '4' },
  { id: 'ground', name: '地面', color: '#67a2e5', shortcut: '5' },
];

export const initialRegistration: Registration = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export const initialAnnotations: Annotation[] = [];
