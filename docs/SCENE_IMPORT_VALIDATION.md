# 跨场景导入、完整覆盖与同步验证（0.12.0）

本版解决单分块/局部半径造成的覆盖缺失，并提供由数据自身位姿驱动的通用导入链路。同步观察始终使用共享的世界朝向和 FOV，每帧使用自己的相机位置和旋转。

## 缺块原因与修复范围

此前尖沙咀试用场景只从 `pointcloud_5.pcd` 提取相机附近 55 m 数据。对该源文件每 50 点抽取一条，共审计 2,019,131 点：约 44.8% 位于 55 m 之外，直接被半径限制排除。原脚本还有高程限制，但该抽样在 55 m 内的高程剔除率为 0%，所以本次主要原因是半径和未加载其他分块。

12 个 `pointcloud_DS_*.pcd` 合计 7,240,756 点；其中 DS_1、DS_3、DS_5 在当前相机 55 m 内也有数据，证明单独加载第 5 块不能代表完整场景。新的尖沙咀场景由以下部分组成：

| 层 | 点数 | 内容 |
| --- | ---: | --- |
| 近处细节 | 4,500,000 | 原有 55 m 的真实 RGB 点，保持原顺序 |
| 全局概览 | 1,715,955 | 读取全部 12 个 DS 分块，无地理半径/高度裁剪；150 m 内保留全部 DS 点，远处空间降采样 |
| 合计 | 6,215,955 | 11 张原始 8K 全景、原逐帧 INS 初值 |

概览使用灰度强度显示，不能用于证明真实 RGB 颜色一致性。全局降采样体素约 1.29 m，近处 DS 的显示点径单独设置；150 m 近区判定采用源世界水平距离，显示层判定采用转换后水平距离，两者在设备有倾角时略有不同。显示点径随距离和 FOV 调整，范围 1–10 像素，不改变点坐标和标注。原始扫描未覆盖、被遮挡的部分及天空仍可能没有点。当前不把十亿级原始点全部放入浏览器，也不补造几何。

重新生成：

```text
python scripts/complete_scene_coverage.py --scene PREVIOUS_DETAIL_SCENE --mapping DS_MAP_FOLDER --frames TREE_FRAME_CSV --output NEW_SCENE_FOLDER
```

这是既有 VMMS 场景的覆盖补全工具；它依赖原场景的基准帧与 TREE 轨迹表。通用新数据导入使用下面的独立入口。

## 新数据自动导入

Windows：安装 Python 3.10+、Node.js 20+，运行 `Import-Scene-Windows.bat "DATASET_FOLDER"`；也可双击后输入路径。macOS：运行 `sh ./Import-Scene-macOS.command "DATASET_FOLDER"`。Python 依赖安装在本目录 `.venv-scene-import` 内，不修改其他项目环境。首次使用需要能访问 Python 包仓库；网络代理异常需先修复本机 pip 的联网配置。

支持的当前目录合同：

```text
DATASET_FOLDER/
  DenseMap.pcd                 # binary PCD，XYZI 或 packed RGB
  imgs/                       # 名称可以不同，须与位姿 CSV 同目录
    CameraPoseInSlam.csv       # 制表符或逗号；Image id + T00..T23
    1.jpg
    2.jpg                     # 2:1 全景；文件主名与 Image id 匹配
    genericImagePositions.csv # 可选；Filename / Timestamp 制表符表
```

在整个数据目录中必须恰好有一个 `CameraPoseInSlam.csv`。会校验所有匹配全景，默认复制全部影像，按影像 ID 排序；`--max-frames 7` 仅提取居中的连续七帧用于快速试用。当前本机场景服务上限为 1000 帧，点云 150 MiB。默认最多约 180 万个空间代表点，保留全图范围及 XYZ 极值，不再只取固定半径。仍属显示降采样，细小目标如不够清晰需提高预算或另建目标局部高精度场景。

```text
python scripts/import_scene_dataset.py DATASET_FOLDER --output PREPARED_SCENE --max-frames 7
node scripts/serve.mjs --scene-dir PREPARED_SCENE
```

输出目录必须不存在，避免覆盖已有标注所依赖的点索引。输出包括点云、原始全景、逐帧 `cameraToCloud`、来源元数据、源与降采样边界及 SHA-256。更新资产后任务 ID 随内容变化，旧逐点标注不会套用到新的索引。

默认坐标配置为源世界 Z-up、相机 FLU（X 前、Y 左、Z 上）、矩阵 camera-to-world。转换为平台 X 右、Y 上、−Z 前：

```text
W = [[1,0,0], [0,0,1], [0,-1,0]]
B = [[0,0,-1], [-1,0,0], [0,1,0]]
cloud = W * (sourcePoint - origin)
cameraRotation = W * sourceRotation * B
cameraPosition = W * (sourceTranslation - origin)
```

`origin` 为所选中间帧的源相机位置，点和位姿共同平移。可通过 `--world-axes z-up|y-up`、`--camera-axes flu|opencv|viewer`、`--matrix-direction camera-to-world|world-to-camera` 明确切换约定；不会猜测未知设备坐标，也不会应用固定 180° 修正。三个新数据集均使用默认配置和各自源位姿。

无匹配影像、重复 ID、非刚体矩阵、影像缺位姿、非 2:1 全景、被截断 PCD 等都会报错；PCL 输出末尾不超过 64 KiB 的纯零/空白填充可按头部声明点数正常读取。导入一般 JSON 时允许部分帧缺位姿，但这些帧会关闭同步并显示“缺少位姿”，直到导入或手动提供当前帧的位姿。

## 四组真实数据验收

2026-11-05，Windows Chrome，来自用户本机 VMMS 文件，原目录只读。除尖沙咀以外均由新通用脚本直接导入，未按场景修改代码或附加 yaw。

| 场景 | 源全景/匹配位姿 | 试用帧 | 显示点数 | 逐帧与手势 |
| --- | ---: | ---: | ---: | --- |
| campus | 136 / 136 | 7 | 1,447,166 | 通过 |
| floor6 | 71 / 71 | 7 | 1,066,346 | 通过 |
| library | 345 / 345 | 7 | 1,667,193 | 通过 |
| 尖沙咀完整覆盖版 | 11 / 11（提取序列） | 11 | 6,215,955 | 通过 |

共 32 帧，逐帧核验两侧实际渲染相机的世界位置、四元数、FOV、切帧世界朝向连续性，以及其位置与各自源矩阵的一致性。位置浮点差最大约 1.8e−15 m，两侧四元数角差最大约 2.5e−6°；这些仅表示软件同步计算一致，**不代表实际配准精度**。每组分别操作点云、全景拖动和全景滚轮，两侧均响应，且不会把观察操作写成外参修改。控制台未出现 WebGL 错误。校园、六层和图书馆进行了静态建筑视觉对照；未建立独立真值，不能宣称 4° 达标。`floor6` 是六楼室外/屋顶数据，本次没有额外证明室内场景泛化。

真实数据的完整 JSON 记录和界面截图保存在本机忽略目录 `local-samples/generalization-suite/`。后台导入和文件服务可重跑：

```text
node scripts/validate_scene_suite.mjs local-samples/generalization-suite
```

UI 复核步骤：对每组逐帧切换，检查两侧同向、相机随帧移动；分别拖动左右视图并缩放；选择“投影叠加”检查静态立柱、墙角、路缘。开发者可读两个视图容器的 `data-view-position`、`data-view-quaternion`、`data-view-fov` 诊断值。自动单元回归运行 `npm run test:scene-import`、`python scripts/test_scene_dataset.py`，另有既有 `test:view-sync`。

`python scripts/test_release_packages.py` 会实际解压两个常规平台 ZIP，启动其中的只读服务并请求两场景清单与资产，防止打包遗漏新网关模块；同时校验 macOS 导入启动器的执行位和构建版本。此测试在 Windows 上运行两个包的通用 Node 服务，并不等于实体 Mac 浏览器验收。

## 接口与 UI 分工

- `pointcloud_io.py` / `import_scene_dataset.py`：源数据验证、全图降采样、坐标配置和逐帧位姿转换。
- `sceneCatalogGateway.mjs`：可选 `scene-catalog/1.0`，用 `?scene=KEY` 路由同源只读资产；只允许目录内真实路径与已登记 key。无目录清单则保持单场景兼容。
- `sceneImport.ts`：清单转任务、来源证据、逐帧位姿和缺位姿门控；普通导入不再误标为 INS。
- `RegistrationWorkflow.tsx`：紧凑的场景下拉框，不新增大组参数面板；显示全图/局部覆盖说明。
- `cloudDisplay.ts` / `PointCloudView.tsx`：强度鲁棒对比、采样间距驱动的点径；无真实 RGB 时不显示“原始颜色”。

当前自动精配准使用无权重球面 NID 本机后端；部署、输入条件、质量检查与限制见 [自动配准说明](AUTOMATIC_REGISTRATION.md)。已有粗位姿仍是前提，候选须人工核验。

双平台常规 ZIP 包只带代码与合成样本；本机 `package_generalization_suite.py --catalog ...` 才生成含四组真实数据的私有试用包。Windows 已实机测试，macOS 使用相同源码和 CI 回归，实体 Mac 的 GPU 性能仍待同事验收。
