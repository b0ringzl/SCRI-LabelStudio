# TREE 点云与全景配准经验迁移

此文记录 2026-11-04 对本机 `TREE/hk-tree-vmms` 的配准相关源码、报告与方案的审阅结果，供 Windows 和 macOS 协作者实现同一套数据契约。TREE 源目录和原始 VMMS 数据不随本仓库发布；文中路径均相对 `TREE/hk-tree-vmms`。这些经验用于室内外建筑组件和标志地物时，几何流程可复用，树木专用的目标筛选规则须替换。

## 已核实的流程与证据

| 环节 | TREE 依据 | 可复用经验与边界 |
| --- | --- | --- |
| 逐帧位姿 | `coordinate_solver.py`，`outputs/coordinates/frame_coordinates.csv`、`coordinate_summary.json` | 以相机帧的 UTC 时间查 INS 轨迹，位置和姿态插值；角度按最短弧插值，轨迹范围外报错。逐帧结果是 **INS 平台位置**，不是 Ladybug 光心。保留 `trajectory_status` 和位置标准差。 |
| 坐标统一 | `coordinate_solver.py`、`README.md` | 映射点云的局部 XYZ 加该测区固定原点，得到 HK80 东、北、高；地图展示才通过 EPSG:2326 → EPSG:4326 变换。点云和相机参与同一计算前，必须先确认它们所在的局部系、原点、单位与轴向。不能把经纬度直接当米坐标投影。 |
| 原始扫描轴向 | `diagnose_lidar_camera_axes.py`、`render_temporal_lidar_panorama.py` | 对何文田原始 RIEGL 扫描，曾以映射彩色点云的近邻距离比较合法轴排列，采用 `body forward=-sensor z, left=+sensor y, up=+sensor x`。这属于该设备/测区的数据解释，其他扫描仪或导出格式须重新检验。 |
| 时间配对与运动补偿 | `render_temporal_lidar_panorama.py` | 用相邻全景时间中点界定主窗口，使原始扫描点分配到一个全景帧；点的绝对时间为扫描文件时间加点内 `time`。每次扫描用点时间中位数插值 INS 位姿，再转到参考全景坐标。该实现是**逐扫描近似补偿**，不是逐点连续轨迹补偿。±0.2/1/3 秒窗口仅供密度与错位对照，不能直接认作同步真值。 |
| 全景投影 | `render_temporal_lidar_panorama.py`、`diagnose_panorama_handedness.py` | 相机采用 FLU：`x=前, y=左, z=上`。`u=wrap(0.5-atan2(y,x)/(2π))`，`v=0.5-asin(z/r)/π`。投影前须应用相机相对平台的旋转和平移；遮挡显示采用最近深度的 z-buffer。 |
| 零方位与左右手校验 | `diagnose_panorama_handedness.py`、`tools/calibrate_inventory_projection.py`、`derived/temporal_lidar_projection/frame_004335/panorama_handedness_report.json`、`derived/exhaustive_species_drafts_20260906/projection_calibration.json` | 彩色点与全景像素比较，以及人工标注与地物方位比较，均提示被测试数据流约有 180° 零方位偏移。后者在 `hewentian_pano` 上拟合 −177°，在 `stubbs_pano_1` 上拟合 −178°。这证明**每条流都要校验零方位和镜像方向**，不证明尖沙咀流可直接套用 180°。何文田部分结果误差仍大，也不构成精确外参。 |
| 空间检索与缓存 | `POINT_CLOUD_AUXILIARY_PLAN.md` | 建立 PCD 包围盒索引，按目标附近空间范围而非“影像序号最近的 PCD”选点；以同一目标 ID 缓存与关联多视角。原方案的树级缓存可推广为建筑组件/地物级缓存。避免网页请求时读取 GB 级建图 PCD。 |
| 外参缺口 | `README.md`、`POINT_CLOUD_AUXILIARY_PLAN.md`、`render_temporal_lidar_panorama.py` | 原数据未提供独立标定的 LiDAR↔Ladybug 杆臂、安装角和完整拼接模型。现有叠加应标记为平台位姿**粗配准**；人工调整可改善局部外观，不能代替可复现的设备外参标定。 |

## 与本项目的对应关系

当前 `scripts/prepare_vmms_sample.py` 读取 TREE 的逐帧 INS 表，对 `20250210-jianshazui` 的映射点云做局部裁剪与坐标旋转，输出浏览器可加载的小样本及来源元数据。`src/geometry.ts` 实现局部相机系到全景 UV 的投影；`src/App.tsx` 与 `src/PanoramaView.tsx` 提供左右并排显示、投影叠加和位姿手调。生成样本时使用 `+X=右, +Y=上, -Z=前` 的浏览器局部系，它与 TREE 的 FLU 系通过 `right=-left, up=up, viewerForward=-forward` 对应。**球面公式一致不等于零方位、光心和时间配准已经核准。**

现已增加逐帧矩阵/硬件外参导入、彩色点云 yaw 候选、同名点位姿求解与多帧目标射线交会，操作及格式见 [配准与定位工作流](REGISTRATION_WORKFLOW.md)。尚未移植原始扫描的逐扫描运动补偿、按帧时间窗口自动配对、厂商标定文件解析、系统化逐流外参验收和大规模空间索引服务。当前示例是周边映射点云抽样，不能称为同一时刻的单帧 LiDAR。TREE 的何文田/司徒拔道 180° 经验应作为尖沙咀校验候选，不能设为该流的无证默认值。

## 后续实现的数据契约

建议在现有简易 `Registration { position, rotation }` 之上增加版本化的配准记录；以下为**完整数据契约的设计目标，当前程序仅实现其中的逐帧矩阵/硬件组合子集**。其中 0 和单位矩阵只是格式占位，不能作为真实外参：

```json
{
  "schemaVersion": "registration/1.0",
  "pairId": "survey/stream/frame",
  "panoramaUtcSeconds": 0.0,
  "pointCloudTimeRangeUtcSeconds": [0.0, 0.0],
  "pointCloudFrame": "survey-local-ENU-m",
  "originCrs": "EPSG:2326",
  "originHk80Meters": [0.0, 0.0, 0.0],
  "insPoseSource": "frame_coordinates.csv",
  "lidarToBody": { "rotationMatrixRowMajor": [1, 0, 0, 0, 1, 0, 0, 0, 1], "translationFluMeters": [0, 0, 0] },
  "bodyToPanorama": { "rotationMatrixRowMajor": [1, 0, 0, 0, 1, 0, 0, 0, 1], "translationFluMeters": [0, 0, 0] },
  "panoramaModel": "equirectangular-FLU",
  "calibrationStatus": "unverified",
  "calibrationSource": "",
  "quality": { "landmarkCount": 0, "medianAngularErrorDeg": null, "p95AngularErrorDeg": null },
  "review": { "status": "pending", "note": "" }
}
```

变换顺序应明确为：原始 LiDAR 点 → 传感器到平台 → 采样时 INS 到测区世界系 → 世界点转至全景帧 INS → 平台到 Ladybug 光心/朝向 → FLU 球面 UV。若使用已映射点云，跳过原始扫描的传感器到平台与逐扫描运动补偿步骤，并记录映射产品来源。零方位偏移属于 `bodyToPanorama`；人工微调另存为可追溯的修正，不覆盖原始外参。

## 验收与迁移顺序

1. **P0 数据审计**：按测区/流识别全景帧、UTC 时间、PCD 字段及坐标原点；产出只含元数据的资产清单。每组点云和影像显示“时间差、空间范围、配准状态”。
2. **P1 粗配准与质检**：把已有 TREE 插值位姿与点云空间索引接入配对任务。对尖沙咀单独使用彩色点、建筑边缘和可辨地物，比较零方位及水平镜像候选；记录样本数与误差，不从何文田复制结论。
3. **P2 原始扫描通路**：按帧时间中点分配点，保留逐点时间，按扫描近似补偿并提供不同窗口的密度/错位对照。若选择更精确的逐点补偿，应单独实现并与逐扫描方法比较。
4. **P3 精配准**：获得或标定杆臂、安装角、全景拼接参数；在距离、方向和遮挡条件不同的静态建筑边缘与地物上，统计重投影误差，并将校准文件版本与标注任务绑定。只有通过此验收后，界面才可把状态由“粗配准”提升为“已校准”。

各阶段保留原始文件只读；衍生缓存可重建。Windows 和 macOS 均使用相同的坐标/时间/JSON 约定，数据根目录通过参数或配置指定，不把 `C:\...` 路径写进可移植的标注记录。真实全景、PCD 和本机生成的衍生文件不随 Git 提交；协作者在获授权的数据副本上复现，并通过元数据及测试报告审阅结果。

## Windows / macOS 使用入口

两端运行同一份前端与配准说明；需要在各自机器上配置获授权的原始 VMMS 目录和 TREE 逐帧坐标表。Windows 用仓库根目录的 `Start-Atlas-Windows.bat` 启动，macOS 用 `sh ./Start-Atlas-macOS.command` 启动。两种启动器都会安装缺失依赖、构建并运行本地服务。现有 `scripts/prepare_vmms_sample.py` 支持 `--vmms`、`--frames`、`--output` 参数，因此可在两端分别指定数据位置；macOS 没有本机 Windows 数据副本时仍可打开仓库内的合成演示数据。
