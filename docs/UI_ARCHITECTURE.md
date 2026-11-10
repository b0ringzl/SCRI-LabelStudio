# UI 架构与接口边界

当前版本 0.13.0 将主导航收敛为四步工作流，采用独立的配准与标注页面。详细页面职责、迁移表、点径修复、导入容量与验收见 [工作流设计](WORKFLOW_UI_0.13.0.md)。

## 页面结构

```text
SCRI Labeling
├─ 数据：任务卡片 / 双源导入 / 本机大点云导入说明 / 图片与 YOLO 导入
├─ 配准：初值 → 同名点精调 → 投影核验
├─ 标注
│  ├─ 点云 + 全景：标注工具、AI 审核、切帧、多帧目标定位与对象属性
│  └─ 普通图片：2D 框、类别修正、AI 审核与人工确认
├─ 训练：已核验统计 / 蒸馏清单 / 联合成果导出 / 服务状态
└─ 项目设置：标签体系 / 模型服务
```

`WorkflowShell.tsx` 统一导航与层级；`DataWorkspace.tsx` 合并导入与数据选择；`RegistrationWorkflow` 仅在配准页挂载；标注页使用没有位姿/求解操作的 `FrameNavigator`。`TrainingWorkspace` 继续调用既有蒸馏清单构建器；真实训练服务尚未连接。`ImageReview` 会话由 App 持有，避免页面切换丢失手选文件和当前图片。

`ViewSync` 世界观测层保持不变：两台渲染相机共享朝向/FOV，相机光心来自当前帧位姿。用户环视不修改外参。对象稳定 ID、模型协议、蒸馏合同和已有 localStorage 键保持兼容；UI 分组不代表模型、标定和训练能力升级。

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
- 单帧全景点只有射线、没有深度。连续全景可按同一对象 ID 保存多个 2D 目标框；各帧有独立位姿且视差足够时，可用框中心射线最小二乘交会生成点云 3D 候选框，保留基线、射线残差和点云近邻距离供人工核验。
- 同名点工具将点云点与当前全景 UV 配成一对，至少四对后用非线性最小二乘求相机六自由度位姿。彩色点云还可用颜色匹配估计当前全景 yaw 候选；两种结果都须检查投影叠加。
- 可共享合成样本和本机可选的尖沙咀样本均以相机局部系显示；普通导入数据可提供逐帧相机→点云矩阵，或逐帧 INS→点云与相机→INS 硬件外参。真实数据的 INS 粗配准可能因杆臂、安装角和时间偏差而产生投影误差。具体 JSON 和验收门槛见 [配准与定位工作流](REGISTRATION_WORKFLOW.md)。

## 模型服务接口

0.12.0 的数据导入与多场景层独立于模型：`sceneCatalogGateway.mjs` 用可选 `scene-catalog/1.0` 描述场景集，向每份清单/资产 URL 追加 `?scene=KEY`。`sceneImport.ts` 统一生成 PairTask、逐帧初值及来源证据，App 处理加载中遮罩、取消过期请求与切换前保存。UI 只增加一个紧凑场景下拉框及覆盖说明；各视图继续订阅同一个 ViewSync，当前帧缺少位姿时关闭同步。点云显示间距提示由 `cloudDisplay.ts` 验证连续范围后传入 GPU，不更改点索引或注册模型接口。源坐标转换和四组真实数据验收详见 [跨场景导入](SCENE_IMPORT_VALIDATION.md)。

`src/prelabel.ts` 定义 `PrelabelProvider.predict(request)`；HTTP 适配器先 `POST {endpoint}/assets` 上传双模态文件，再 `POST {endpoint}/predict`。工作台已接入模型选择与人工审核；普通图片使用单独的 `atlas-image-v1` 适配器。详细协议见 [模型接口契约](MODEL_API.md)及[切换说明](MODEL_SWITCHING.md)。

视觉 LLM 使用另一条适配路径：`src/modelRegistry.ts` 保存千问／DeepSeek 模型名称，`src/modelApi.ts` 将当前图片或全景缩放后送到同源 `/api/llm/predict`，`scripts/llmGateway.mjs` 按提供方读取各自的 Key、允许模型和上游地址。服务端仅接受本机同源请求，并验证类别和归一化框。图片框进入图片候选层；全景框转为右侧全景多边形候选，不自动关联点云 3D 对象。详见 [LLM 接入说明](LLM_PROVIDERS.md)。

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

下一阶段建议增加后端资产库、任务库及异步作业队列，接入真实模型。前端已按同一对象 ID 展示接受的模型预标注及来源信息；真实的自动 2D/3D 对应仍需要标定外参或额外配准求解。


## 0.14.0 轮廓编辑

标注页工具下使用一行上下文操作栏，支持多边形/两点矩形、完成、撤销重做、增删顶点及重绘。`PanoramaEditor` 将归一化球面顶点投影为随相机移动的编号手柄，拖动不改变观察视角；`panoramaContours` 负责接缝、几何校验与多帧可见点交集；`annotationHistory` 保存页面内跨帧快照。`App` 协调当前帧轮廓与派生框失效。多帧观测新增可选 vertices，旧 bounds 仍兼容。详见 [轮廓操作与数据接口](PANORAMA_CONTOUR_EDITING.md)及 [逐项变化](CHANGELOG_0.14.0.md)。


0.14.1 新增逐帧 `observations[].extent`（object/surface，缺失按 surface），新人工对象默认圈完整物体。`triangulation.extent` 区分整体与单面候选；模式进入撤销历史、编辑保持、范围变更清除派生框，混用会拒绝定位。未改变模型推理或训练端点。界面流程及代码入口见 [墙体厚度说明](WALL_VOLUME_0.14.1.md)。
