# SCRI Labeling · 点云与全景联合标注原型

> 公开成果镜像 · v0.16.0。包含可运行源码、双平台启动/打包脚本、DA²/NID 配准及模型/蒸馏接口。真实调查数据、含实测影像的视频、模型大权重、密钥及本机环境不在公开版中。公开贡献请向本仓库 main 提交 PR。详见 [公开版同步说明](docs/PUBLIC_SYNC_0.16.0.md)。

配准模块独立手册（2026-11-10 第 4 版，适用 0.16.0）：[Windows PDF](docs/manuals/Registration-Manual-Windows.pdf) · [macOS PDF](docs/manuals/Registration-Manual-macOS.pdf) · [完整 Markdown 原稿](docs/REGISTRATION_MANUAL.md)。两版各 31 页，保留 10 张合成教学操作图解，第 16 章新增 DA² 安装、深度查看、位姿候选核验和指标解释，附位姿提取工具与格式示例。

一个参考 Label Studio 工作流的点云与全景多源标注工具。支持数据导入、逐帧位姿与同名点配准、双向视角同步、多帧目标定位、人工标注与纠错、千问／DeepSeek 模型接口及蒸馏数据接口。0.16.0 新增 DA² 单全景深度辅助配准，可与原有无需权重的 NID 方法切换。

DA² 安装：Windows 运行 `Setup-Depth-Windows.bat`；Apple Silicon macOS 执行 `sh ./Setup-Depth-macOS.command`。使用项目独立 `.venv-da2` 和公开官方权重；运行平台后在“配准 → 粗配准”选择 DA²，生成深度并预览位姿候选。需要粗位姿，单目深度不是米制真值；不通过检查时保留原位姿。[安装、模型接口与 UI 用法](docs/DEPTH_REGISTRATION.md) · [0.16.0 详细变更](docs/CHANGELOG_0.16.0.md)。

自动精配准安装：Windows 运行 `Setup-Registration-Windows.bat`；macOS 运行 `sh ./Setup-Registration-macOS.command`。两者创建项目独立环境 `.venv-registration`，再用原 Start-Atlas 启动器打开平台。需要 Python 3.10+，CPU 即可运行。先导入粗位姿，再在“配准 → 粗配准 → 自动精配准”生成候选，预览后选择应用或舍弃。

[自动配准部署、API 与实测边界](docs/AUTOMATIC_REGISTRATION.md) · [0.15.0 详细更新](docs/CHANGELOG_0.15.0.md)。这是独立的 NumPy/SciPy 球面 NID 实现，不是已部署的 Koide 官方 C++ 程序；不承诺无初值全局配准或真实数据 ≤4°。


0.14.1 修正有厚度物体被压成薄面的情况。多帧目标框新增“完整物体（含侧面）/单个表面”范围；整体轮廓允许侧面点在一帧可见、另一帧被遮挡，并使用水平最小面积方向拟合体积。旧正面标注保持单面解释，界面显示候选深度 D 并要求核验。操作与接口见 [墙体厚度说明](docs/WALL_VOLUME_0.14.1.md)及 [更新说明](docs/CHANGELOG_0.14.1.md)。

0.14.0 增加可编辑全景轮廓：多帧目标框默认沿边缘逐点圈选，适配斜置和不规则目标；绘制前后均可拖动、增删顶点，支持 Windows Ctrl / macOS Cmd 撤销重做。实际轮廓参与多帧点云交集和候选框拟合，修改后清除旧候选并要求重新核验。旧矩形兼容读取。操作、接口和限制见 [轮廓编辑指南](docs/PANORAMA_CONTOUR_EDITING.md)与 [0.14.0 逐项改动](docs/CHANGELOG_0.14.0.md)。

0.13.1 修复视角切换：关闭同步后，点云保留当前相机位置、完整朝向与缩放，再继续独立操作；只有主动选择透视/俯视/正视预设才重置取景。重新同步使用最后共同观察方向与当前帧光心，不把独立观察写成外参。实现与验证见 [0.13.1 更新说明](docs/CHANGELOG_0.13.1.md)。

## 四步工作流 Demo（0.13.0）

主导航统一为 **数据 → 配准 → 标注 → 训练**，标签与模型收进“项目设置”。旧任务列表和数据源合并为数据管理；普通图片复核归入标注类型；标注页移除配准步骤、同名点和外参参数。图片、核验状态和当前帧在页面之间切换时保留。训练页导出已确认样本的蒸馏清单，真实训练服务尚未连接。

点大小现在支持滑杆、＋/−、固定像素与自适应模式；修复近处点被 GPU 点径上限卡住的问题，点云窗口也可实际放大还原。双源导入从“数据 → 导入数据”进入。**150 MiB 仅为浏览器直读阈值**，更大的源点云走本机预处理入口，保持全图范围并生成显示点云；当前尚未提供原始海量点的分块流式加载。交互、迁移表、接口分工及双平台操作见 [UI 设计与验证](docs/WORKFLOW_UI_0.13.0.md)、[更新说明](docs/CHANGELOG_0.13.0.md)。

## 跨场景自动导入与完整点云覆盖（0.12.0）

已用 **campus、floor6、library 和尖沙咀四组真实数据，共 32 帧**验证逐帧切换、相机位置、双向转动与缩放同步。前三组各自的 136、71、345 张源全景均与 SLAM 位姿匹配并验证格式，试用版各复制中间七帧，未套用尖沙咀的 180° 修正。尖沙咀从单分块/55 m 局部数据扩展为 **全部 12 个 DS 分块的全局概览 + 450 万局部 RGB 细节，共 6,215,955 点**；概览降采样但无地理裁剪。天空、遮挡及原始扫描未覆盖处仍可能没有点。

Windows 运行 `Import-Scene-Windows.bat "DATASET_FOLDER"`，macOS 运行 `sh ./Import-Scene-macOS.command "DATASET_FOLDER"`，自动校验 DenseMap、全景和 CameraPoseInSlam，转换每帧坐标并打开本机工作台。依赖装在本目录虚拟环境。支持显式坐标配置、全图空间采样、多场景切换（0.13.0 起使用数据卡片）和独立保存；数据缺位姿或文件损坏会明确报错。默认使用已有源位姿完成粗初始化；无位姿数据仍需算法/外参/人工标定。**上述同步测试不是实际配准误差的证明，尚未独立验收 4° 精度。** 详细说明、复现命令和 UI/接口分工见 [跨场景导入与验证](docs/SCENE_IMPORT_VALIDATION.md)、[逐项变更](docs/CHANGELOG_0.12.0.md)。常规 Windows/macOS 包只带合成样本；含四组真实数据的试用包保留本地。

## 历史单场景试用（0.11.0）

0.11.0 将配准页收敛为“粗配准 → 同名点精调 → 投影核验”，支持分屏/全宽投影切换、双向旋转和缩放同步，以及切帧时同步相机位置。相机参数和算法服务折叠在“更多设置”。本机真实场景已升级为 **450 万个实际 RGB 点、55 m 范围和 11 张原始 8K 全景**，采用空间去重与显示增强；当前使用 INS 加待核验的 180° 朝向粗初值，未证明 4° 精度。双平台操作、重现与开发入口见 [同步观察与精细配准](docs/SYNCHRONIZED_REGISTRATION.md)、[0.11.0 更新说明](docs/CHANGELOG_0.11.0.md)。源码和文档进入仓库，真实数据保留在本机忽略目录内。旧 75 万点场景说明保留在 [0.10.3 场景记录](docs/TRIAL_SCENE.md)。

## 千问与 DeepSeek 视觉辅助预标注

**已提供可切换的接入接口**：在“项目设置 → 模型服务”页新增模型服务，选择“千问视觉 · 本机代理”或“DeepSeek 视觉 · 本机代理”，填写允许使用的模型名（示例分别为 `qwen3-vl-plus`、`deepseek-flash`）。两家模型可同时配置，分别选择用于普通图片或点云／全景配对任务；模型权重不包含在仓库中。

| 提供方 | 启动前在终端设置 | 模型示例 |
| --- | --- | --- |
| 千问（百炼） | `DASHSCOPE_API_KEY`、所在地域的 `ATLAS_LLM_BASE_URL`、`ATLAS_LLM_MODELS` | `qwen3-vl-plus` |
| DeepSeek | `DEEPSEEK_API_KEY`、`ATLAS_DEEPSEEK_MODELS`；企业网关可另设 `ATLAS_DEEPSEEK_BASE_URL` | `deepseek-flash` |

设置环境变量后，从**同一个终端**运行 Windows 的 `Start-Atlas-Windows.bat` 或 macOS 的 `Start-Atlas-macOS.command`。进入标注页选择模型并点击“运行当前图片”或“运行当前配对任务”；预测先显示为待审核候选，人工接受后才进入标注。普通图片返回 2D 框候选；配对任务只把当前全景影像发送给视觉模型，返回全景 2D 区域候选，**不会由视觉 LLM 生成点云 3D 框或逐点标签**。API Key 仅由本机启动进程读取，不填入界面或提交到仓库；运行预测时当前影像会发送给对应模型服务。

Windows/macOS 的完整模型接入命令见 [千问／DeepSeek 指南](docs/LLM_PROVIDERS.md)，其他 HTTP 标注模型见 [模型切换与审核](docs/MODEL_SWITCHING.md)。




当前自动精配准与双平台交付见 [0.15.0 更新说明](docs/CHANGELOG_0.15.0.md)。

现有 VMMS 数据的其他开源自动配准路线、三帧强度诊断与 4° 旋转误差验收设计见 [配准可行性方案](docs/REGISTRATION_OPTIONS_4DEG.md)，附 [Windows](docs/REGISTRATION_PLAN-Windows.md) 与 [macOS](docs/REGISTRATION_PLAN-macOS.md) 实施说明。

已对用户提供的六自由度 CSV 执行 20 帧、48 种解释与单位矩阵的双分辨率对照；结果仍不足以确认方向、单位和来源。0.10.2 提供可独立复现的 Windows/macOS 验证工具，详见 [外参试验与操作说明](docs/EXTRINSICS_VALIDATION.md)和 [更新说明](docs/CHANGELOG_0.10.2.md)。代理评分不作为 4° 精度证明，也不会自动应用这些参数。

## 教师模型蒸馏接口

可把千问／DeepSeek 的候选结果人工审核后作为自有 **2D 检测模型**的训练标签。训练页提供“导出训练清单”：只包含已确认图片、归一化框和教师来源，保留已确认的空图；原始影像需单独交给外部训练服务。训练服务接口定义了影像集上传、数据集注册、异步训练、独立真值评估和任务状态查询；仓库目前**不运行训练，也不自动部署学生模型**。当前视觉 LLM 没有提供可用 logits，这一版使用经人工确认的硬标签；全景 2D 候选不能直接训练点云 3D 框。数据结构、请求示例及同事分工见 [蒸馏接口设计](docs/DISTILLATION_API.md)。

## 当前批次：道路设施预标注复核

道路设施复核任务以 `label/data` 中的文件为准。`data_for_annotation` 有 900 张普通 JPG 与同名 YOLO 标签，类别是 `sign`、`sign_s`、`fence`、`sign_p`、`fence_v`、`sign_d`、`pole`。从“数据 → 普通图片 + YOLO”导入，再进入“标注 → 普通图片”：可增删、移动、调整 2D 框，修正类别，筛选疑似重复框，逐张确认并导出 YOLO ZIP。具体定义和一致性规则见 [道路设施复核说明](docs/ROAD_FURNITURE_REVIEW.md)。这批目录没有点云文件；原有点云/全景联合工作台仍保留在导航中。

真实道路设施图片、标签和 PPTX 只在本机读取，不提交仓库，也不进入 Windows/macOS 交付包。其他电脑运行时，在复核页选择 `data_for_annotation` 文件夹即可。当前默认复核的是文件中已有的预测结果；如另行配置兼容服务，可对当前图片重新运行模型并审核候选。

## 本地打开

需要 Node.js 20+。两平台共用同一套前端代码，提供分别可启动的交付 ZIP：

| 系统 | 解压后启动文件 | 平台说明 |
| --- | --- | --- |
| Windows | `Start-Atlas-Windows.bat` | [Windows 版说明](docs/README-Windows.md) |
| macOS | `Start-Atlas-macOS.command` | [macOS 版说明](docs/README-macOS.md) |

ZIP 已包含构建结果与示例数据。启动脚本会在本机开启网页并用默认浏览器打开；窗口关闭后服务停止，因此先前的本地地址不能永久访问。服务只绑定 `127.0.0.1`，默认从 43127 端口开始尝试，占用时自动改用下一个可用端口。以窗口显示的实际地址为准。

在源码目录也可直接运行对应系统的启动文件，它会先构建再打开。开发时运行 `npm ci`、`npm run dev`；生成两个交付包使用 `npm run build`、`npm run package`（需要 Python 3），文件输出到 `release/`。

## GitHub 协作

团队开发主线另行维护，本仓库用于公开成果同步与交流。公开贡献在功能分支提交 PR 到本仓库 main，由维护者审核并同步。现有功能、代码入口、能力边界和两平台验证见 [功能与协作交接](docs/FEATURE_HANDOFF.md)。

本轮道路设施复核、模型切换和千问／DeepSeek 接入的逐提交说明见 [2026-10-09 合并说明](docs/MERGE_NOTES_2026-10-09.md)。

源码、可共享的合成演示数据、双平台启动脚本和打包脚本可放入同一个 GitHub 仓库。`node_modules/`、`dist/`、`release/` 及真实尖沙咀裁剪样本不提交；每次推送或发起 PR 后，[构建工作流](.github/workflows/build.yml)检查 TypeScript 和打包，并上传两个 ZIP 作为 Actions artifacts。协作者按 [贡献指南](CONTRIBUTING.md)提交 PR。模型、蒸馏与界面协作分别参阅 [模型接口契约](docs/MODEL_API.md)、[蒸馏接口设计](docs/DISTILLATION_API.md) 和 [UI 设计说明](docs/UI_DESIGN.md)。

### 演示与数据

公开版提供合成建筑点云、全景及 10 张操作图解。包含真实测区影像的视频与工程不随公开版发布；无需这些素材即可构建、运行或阅读手册。DA² 的真实图像深度与投影对比保留在本机，公开变更说明只提供去掉资产的指标及能力边界。

## 已实现的工作流

1. **数据管理**：每项任务配对一份 PCD 或 PLY 点云、一张 2:1 等距柱状全景 JPG 或 PNG，以及可选的配准 JSON。浏览器直接导入的点云上限为 150 MiB；大源文件使用本机预处理。
2. **左右同步工作台**：左侧 Three.js 三维点云，右侧可环视的球面全景。分屏模式下两视图同时显示并默认同步观察，也可切全宽投影叠加。
3. **共享对象标注**：点云单击创建默认 3D 框，或拖拽矩形从选区点拟合中心、尺寸与水平旋转角；全景点击创建点，或逐点绘制多边形。选中已有对象后去另一视图绘制，两份标注共享同一个 `OBJ-*` ID。右侧可编辑类别、名称、3D 框中心、尺寸和 Yaw。
4. **直接编辑 3D 框**：选中框后，在点云左下方切换“移动 / 尺寸 / 旋转”，拖动三维手柄调整；“定位到框”会靠近目标，方便微调。旋转限制为水平 Yaw，右侧数值仍可精确输入。
5. **逐点类别涂抹**：先选类别，切换“点云涂抹”后拖动笔刷；Shift 拖拽框选，Alt 拖动擦除，支持撤销上一步。结果给原始点索引分配类别，并在点云中着色，与对象 3D 框并存。逐点结果保存于当前浏览器，也包含在导出的 JSON 中。见 [简化标注流程](docs/labeling-workflow.md)。
6. **配准校验**：导入粗位姿后运行无权重自动精配准，预览与原位姿比较后应用或舍弃；也可用同名点求解并独立核验。候选不等于精度验收。
7. **类别与结果**：可添加类别；数字键 1–9 切换对应类别。标注和配准参数可保存到当前浏览器的 `localStorage`，或导出包含两种模态结果的 JSON。
8. **可切换模型服务**：配置多个图片或点云／全景 HTTP 模型，在相应工作台选择并运行当前任务。预测先进入待审核层，人工接受后才成为标注。见 [模型切换与审核](docs/MODEL_SWITCHING.md)和[接口契约](docs/MODEL_API.md)。

点云标注交互参考 [SUSTechPOINTS 的操作说明](https://github.com/naurril/SUSTechPOINTS/blob/dev-auto-annotate/doc/operations.md)：可切换透视、俯视和正视，选择 3D 框后直接拖拽拟合；在浏览模式下也可按 Ctrl 拖拽。点击现有框可选中对象，点大小按钮用于检查稀疏细节，“聚焦”可压暗框外点。选中框后方向键平移，PageUp/PageDown 升降，Q/E 旋转，Delete 删除，Esc 取消选择。当前拟合使用水平 PCA 与分位数边界，未采用 SUSTechPOINTS 的 region grow 实现；没有复制其源码。

浏览器文件导入使用 `blob:` URL，导入任务在刷新页面后需要重新选择文件；启动时通过 `--scene-dir` 挂载的场景可自动重载。要接入远端推理服务，需先建立上传或可访问资产 URL 的后端流程，不能直接把 `blob:` URL 或本机资产地址交给远端服务。

## 演示数据与真实样本配准依据

GitHub 仓库默认提供 `public/demo-cloud.pcd` 和 `public/demo-panorama.png`，由 `python scripts/create_synthetic_demo.py` 生成，不对应任何真实地点。若本机源码目录存在 `public/sample-cloud.pcd` 和 `public/sample-panorama.jpg`，工作台优先打开真实裁剪样本；否则自动使用合成样本。真实样本已在 `.gitignore` 中排除，双平台 ZIP 打包脚本也默认排除它；发布前须单独确认数据分享权限。

本机可选的真实示例来自 `20250210-jianshazui` 的 Ladybug 全景帧 `001298`。`scripts/prepare_vmms_sample.py` 读取本机 TREE 项目的 `frame_coordinates.csv`，用该帧的插值 INS 位姿把相机附近 42 m 的映射点云变换为相机局部系，再从附近的降采样 PCD 中选取最多 100,000 点。处理后文件位于 `public/sample-cloud.pcd`、`public/sample-panorama.jpg` 和 `public/sample-metadata.json`。脚本只读取原始数据，不修改原目录。

连续帧演练可运行 `python scripts/prepare_vmms_sequence.py`，生成同一局部点云下的三张真实全景和逐帧位姿 JSON，导入方法见 [配准工作流](docs/REGISTRATION_WORKFLOW.md)。输出位于 Git 忽略的 `local-samples/`，仅作本机核验。

局部坐标约定为 **+X 向右、+Y 向上、−Z 向前**。与 TREE 的 Ladybug 球面投影约定对应：

```text
u = 0.5 − atan2(left, forward) / (2π)
v = 0.5 − asin(up / distance) / π
```

这一初始配准由平台 INS 位姿和周边映射点云生成。现有数据中没有经过独立标定的 LiDAR 到 Ladybug 杆臂及安装角，因此它是**粗配准**；投影叠加用于人工检查，界面中的位置和角度调节可补偿局部偏差。示例点云是站点周围的局部抽样，不能代表整份原始多 GB 点云或严格同一时刻的单帧扫描。TREE 在其他数据流中发现约 180° 的全景零方位偏移；**尖沙咀流尚未完成独立零方位校验**，不要把当前示例叠加当作已校准结果。证据、坐标/时间约定及后续接入契约见 [TREE 配准经验迁移](docs/TREE_REGISTRATION_TRANSFER.md)。

如需重新生成内置样本，在原始 VMMS 与 TREE 数据仍位于本机指定路径时运行：

```powershell
python .\scripts\prepare_vmms_sample.py
```

也可通过 `--vmms`、`--frames`、`--output`、`--stream`、`--frame`、`--radius`、`--max-points` 指定其他数据。

## 导入配准 JSON


点云坐标与相机位置必须处于同一个坐标系，示例数据格式：

```json
{
  "position": [0, 0, 0],
  "rotation": [0, 0, 0]
}
```

`rotation` 依次为 yaw、pitch、roll，单位为角度。零旋转时相机朝 −Z。可以直接传这个对象，也可以包在 `{ "registration": { ... } }` 中。导入普通 PCD/PLY 时不会自动根据拍摄时间求外参；需要提供相机位姿或在配准页手动核验。

## 目录

- `src/App.tsx`：导航、原有联合标注工作台、任务管理和配准页。
- `src/ImageReview.tsx`、`src/reviewData.ts`：道路设施 2D 预标注复核与 YOLO 导出。
- `src/PointCloudView.tsx`：PCD/PLY 三维显示及 3D 框拾取。
- `src/PanoramaView.tsx`：全景球面显示、点和多边形绘制、点云投影叠加。
- `src/geometry.ts`：坐标变换、球面投影和近射线点查询。
- `src/boxFitting.ts`：点云选区初始拟合、旋转框内点检测与计数。
- `src/types.ts`：任务、类别、配准、联合标注和模型接口数据类型。
- `src/modelRegistry.ts`、`src/modelApi.ts`、`src/prelabel.ts`：标注模型配置、协议校验和 HTTP 适配器。
- `src/distillation.ts`、`src/distillationContract.ts`、`src/distillationClient.ts`：已审核训练清单、蒸馏服务类型与客户端接口。
- `scripts/prepare_vmms_sample.py`：内置真实样本预处理。
- `src/automaticRegistration.ts`、`scripts/registrationGateway.mjs`、`scripts/registration_worker.py`：无权重自动精配准采样、网关与六自由度求解。

当前自动精配准需粗位姿与有效原始信号，候选须独立核验；不保证无初值全局配准或 ≤4°。本版本仍以本机工作流和接口为主，真实多人持久化后端、跨帧共享外参联合优化与训练服务尚未接通。
