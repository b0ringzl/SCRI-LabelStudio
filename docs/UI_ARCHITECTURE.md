# UI 架构与接口边界

## 页面结构

```text
Atlas Studio
├─ 标注工作台
│  ├─ 任务信息与保存 / 导出
│  ├─ 工具栏：浏览、3D 框、点云涂抹、全景点、全景多边形、投影核验
│  ├─ 左视图：点云 PCD / PLY
│  ├─ 右视图：等距柱状全景 JPG / PNG
│  └─ 对象面板：类别、对象列表、属性与跨视图关联状态
├─ 任务列表：成对数据的管理入口
├─ 数据源：导入点云、全景、可选相机位姿
├─ 标签体系：共享类别表
├─ 配准校验：叠加投影、微调相机位姿
└─ 预标注接口：服务地址与请求 / 响应契约
```

整体沿用 Label Studio 式“项目导航 → 任务 → 标注工作台 → 结果”的信息架构。这里的一个任务由两种模态共同组成。标注对象有单一稳定 ID，每个对象分别持有可选的 `pointCloud` 和 `panorama` 形状；因此可先标一侧，再由人工选择该对象关联另一侧。

## 核心数据结构

以 `src/types.ts` 为准。导出 JSON 的主要层级：

```json
{
  "schemaVersion": "0.2",
  "task": {
    "id": "JSZ-001298",
    "pointCloudName": "sample-cloud.pcd",
    "panoramaName": "sample-panorama.jpg"
  },
  "coordinateSystem": "camera-local: +X right, +Y up, -Z forward",
  "registration": {
    "position": [0, 0, 0],
    "rotation": [0, 0, 0]
  },
  "classes": [],
  "annotations": [
    {
      "id": "OBJ-001",
      "classId": "sign",
      "name": "标志牌 1",
      "origin": "manual",
      "visible": true,
      "pointCloud": {
        "kind": "cuboid",
        "center": [1, 2, -8],
        "size": [1.4, 1.4, 1.4],
        "yaw": 15
      },
      "panorama": {
        "kind": "point",
        "uv": [0.52, 0.48]
      }
    }
  ]
}
```

全景 `uv` 为归一化图像坐标。多边形改用 `{ "kind": "polygon", "vertices": [[u, v], ...] }`。3D 框的 `yaw` 是绕 +Y 的角度；旧标注没有该字段时按 0° 读取。导出文件另含 `semanticPointLabels`，以原始点索引和类别 ID 保存逐点分类。完整的 roll/pitch 旋转框仍待扩展。

## 点云交互参考

[SUSTechPOINTS](https://github.com/naurril/SUSTechPOINTS) 提供矩形选区建框、框体旋转与尺寸修订、多视角检查、点大小和聚焦等交互。本原型独立实现了适合单组点云与全景配对任务的部分：屏幕选区筛点，水平 PCA 得到初始方向，2%–98% 分位数得到 3D 边界，并允许人工继续修正。它不执行 SUSTechPOINTS 文档中的 region grow、自动贴边、逐帧轨迹或批量编辑。

## 配准与视图联动

- 点云和相机位姿必须在同一个三维坐标系中。把 3D 点减去 `registration.position`，再应用相机旋转的逆，即得相机局部方向。
- 相机局部约定为 +X 右、+Y 上、−Z 前。按 TREE 的 Ladybug 球面公式算 `uv`，用于点云投影叠加、3D 框在全景中的候选位置与跨视图聚焦。
- 从全景点反推三维时只有一条射线，缺少深度；当前仅提示附近点云候选点，不自动建立几何对应。跨视图标注归属由人工选择共享对象 ID。
- 可共享合成样本和本机可选的尖沙咀样本均以相机局部系显示；普通导入数据需提供正确的相机位姿。真实数据的 INS 粗配准可能因杆臂、安装角和时间偏差而产生投影误差。

## 未来服务接口

`src/prelabel.ts` 定义 `PrelabelProvider.predict(request)`；HTTP 适配器约定先 `POST {endpoint}/assets` 上传双模态文件，再 `POST {endpoint}/predict`。详细协议见 [模型接口契约](MODEL_API.md)。

| 字段 | 说明 |
| --- | --- |
| `taskId` | 配对任务 ID |
| `pointCloudAssetId` / `panoramaAssetId` | 上传后服务返回的资产 ID |
| `pointCount` / `coordinateSystem` | 点索引总数与三维坐标系约定 |
| `registration` | 当前相机位置与角度 |
| `classes` | 当前类别定义 |
| 返回 `annotations[]` | 与人工标注共用的数据结构，`origin` 设为 `prediction` |
| 返回 `modelVersion` | 可选模型版本 |
| 返回 `semanticPointLabels[]` | 可选逐点类别和置信度 |

建议下一阶段增加后端资产库与任务库，再接入模型推理。这样前端可以按同一对象 ID 显示模型预标注、人工修订和来源信息；真实的自动 2D/3D 对应需要标定外参或额外配准求解。
