# Atlas Studio · 点云与全景联合标注原型

一个参考 Label Studio 工作流的前端原型，用于室内外建筑组件、标志和地物的多源标注。当前阶段实现界面、配对数据导入、配准核验、人工标注，以及可切换 HTTP 模型服务的预测与人工审核流程。仓库不包含真实 AI 模型或服务端数据库。

## 千问与 DeepSeek 视觉辅助预标注

**已提供可切换的接入接口**：在“预标注接口”页新增模型服务，选择“千问视觉 · 本机代理”或“DeepSeek 视觉 · 本机代理”，填写允许使用的模型名（示例分别为 `qwen3-vl-plus`、`deepseek-flash`）。两家模型可同时配置，分别选择用于普通图片或点云／全景配对任务；模型权重不包含在仓库中。

| 提供方 | 启动前在终端设置 | 模型示例 |
| --- | --- | --- |
| 千问（百炼） | `DASHSCOPE_API_KEY`、所在地域的 `ATLAS_LLM_BASE_URL`、`ATLAS_LLM_MODELS` | `qwen3-vl-plus` |
| DeepSeek | `DEEPSEEK_API_KEY`、`ATLAS_DEEPSEEK_MODELS`；企业网关可另设 `ATLAS_DEEPSEEK_BASE_URL` | `deepseek-flash` |

设置环境变量后，从**同一个终端**运行 Windows 的 `Start-Atlas-Windows.bat` 或 macOS 的 `Start-Atlas-macOS.command`。进入标注页选择模型并点击“运行当前图片”或“运行当前配对任务”；预测先显示为待审核候选，人工接受后才进入标注。普通图片返回 2D 框候选；配对任务只把当前全景影像发送给视觉模型，返回全景 2D 区域候选，**不会由视觉 LLM 生成点云 3D 框或逐点标签**。API Key 仅由本机启动进程读取，不填入界面或提交到仓库；运行预测时当前影像会发送给对应模型服务。

Windows PowerShell 与 macOS Terminal 的完整启动命令、地域地址和接口边界见 [千问／DeepSeek 接入指南](docs/LLM_PROVIDERS.md)；其他 HTTP 模型的配置与审核流程见 [模型切换说明](docs/MODEL_SWITCHING.md)。云端模型的实际定位效果仍需使用团队数据验证。

## 教师模型蒸馏接口

可把千问／DeepSeek 的候选结果人工审核后作为自有 **2D 检测模型**的训练标签。道路设施复核页新增“导出蒸馏清单”：只包含已确认图片、归一化框和教师来源，保留已确认的空图；原始影像需单独交给外部训练服务。训练服务接口定义了影像集上传、数据集注册、异步训练、独立真值评估和任务状态查询；仓库目前**不运行训练，也不自动部署学生模型**。当前视觉 LLM 没有提供可用 logits，这一版使用经人工确认的硬标签；全景 2D 候选不能直接训练点云 3D 框。数据结构、请求示例及同事分工见 [蒸馏接口设计](docs/DISTILLATION_API.md)。

## 当前批次：道路设施预标注复核

本次任务以 `label/data` 中的文件为准。`data_for_annotation` 有 900 张普通 JPG 与同名 YOLO 标签，类别是 `sign`、`sign_s`、`fence`、`sign_p`、`fence_v`、`sign_d`、`pole`。启动后默认进入“道路设施复核”：可增删、移动、调整 2D 框，修正类别，筛选疑似重复框，逐张确认并导出 YOLO ZIP。具体定义和一致性规则见 [道路设施复核说明](docs/ROAD_FURNITURE_REVIEW.md)。这批目录没有点云文件；原有点云/全景联合工作台仍保留在导航中。

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

本轮道路设施复核、模型切换和千问／DeepSeek 接入的逐提交说明见 [2026-10-09 合并说明](docs/MERGE_NOTES_2026-10-09.md)。

源码、可共享的合成演示数据、双平台启动脚本和打包脚本可放入同一个 GitHub 仓库。`node_modules/`、`dist/`、`release/` 及真实尖沙咀裁剪样本不提交；每次推送或发起 PR 后，[构建工作流](.github/workflows/build.yml)检查 TypeScript 和打包，并上传两个 ZIP 作为 Actions artifacts。协作者按 [贡献指南](CONTRIBUTING.md)提交 PR。模型、蒸馏与界面协作分别参阅 [模型接口契约](docs/MODEL_API.md)、[蒸馏接口设计](docs/DISTILLATION_API.md) 和 [UI 设计说明](docs/UI_DESIGN.md)。

## 已实现的工作流

1. **任务列表 / 数据源**：每项任务配对一份 PCD 或 PLY 点云、一张 2:1 等距柱状全景 JPG 或 PNG，以及可选的配准 JSON。浏览器直接导入的点云上限为 150 MB。
2. **左右同步工作台**：左侧 Three.js 三维点云，右侧可环视的球面全景。两视图始终同时显示，可以分别交互。
3. **共享对象标注**：点云单击创建默认 3D 框，或拖拽矩形从选区点拟合中心、尺寸与水平旋转角；全景点击创建点，或逐点绘制多边形。选中已有对象后去另一视图绘制，两份标注共享同一个 `OBJ-*` ID。右侧可编辑类别、名称、3D 框中心、尺寸和 Yaw。
4. **直接编辑 3D 框**：选中框后，在点云左下方切换“移动 / 尺寸 / 旋转”，拖动三维手柄调整；“定位到框”会靠近目标，方便微调。旋转限制为水平 Yaw，右侧数值仍可精确输入。
5. **逐点类别涂抹**：先选类别，切换“点云涂抹”后拖动笔刷；Shift 拖拽框选，Alt 拖动擦除，支持撤销上一步。结果给原始点索引分配类别，并在点云中着色，与对象 3D 框并存。逐点结果保存于当前浏览器，也包含在导出的 JSON 中。见 [简化标注流程](docs/labeling-workflow.md)。
6. **配准校验**：将稀疏点云投影到全景上，并调整相机位置及 yaw、pitch、roll。点云中显示相机位置标记。
7. **类别与结果**：可添加类别；数字键 1–9 切换对应类别。标注和配准参数可保存到当前浏览器的 `localStorage`，或导出包含两种模态结果的 JSON。
8. **可切换模型服务**：配置多个图片或点云／全景 HTTP 模型，在相应工作台选择并运行当前任务。预测先进入待审核层，人工接受后才成为标注。见 [模型切换与审核](docs/MODEL_SWITCHING.md)和[接口契约](docs/MODEL_API.md)。

点云标注交互参考 [SUSTechPOINTS 的操作说明](https://github.com/naurril/SUSTechPOINTS/blob/dev-auto-annotate/doc/operations.md)：可切换透视、俯视和正视，选择 3D 框后直接拖拽拟合；在浏览模式下也可按 Ctrl 拖拽。点击现有框可选中对象，点大小按钮用于检查稀疏细节，“聚焦”可压暗框外点。选中框后方向键平移，PageUp/PageDown 升降，Q/E 旋转，Delete 删除，Esc 取消选择。当前拟合使用水平 PCA 与分位数边界，未采用 SUSTechPOINTS 的 region grow 实现；没有复制其源码。

本地导入使用浏览器 `blob:` URL，导入任务在刷新页面后需要重新选择文件。要接入远端推理服务，需先建立上传或可访问资产 URL 的后端流程，不能直接把 `blob:` URL 交给服务端。

## 演示数据与真实样本配准依据

GitHub 仓库默认提供 `public/demo-cloud.pcd` 和 `public/demo-panorama.png`，由 `python scripts/create_synthetic_demo.py` 生成，不对应任何真实地点。若本机源码目录存在 `public/sample-cloud.pcd` 和 `public/sample-panorama.jpg`，工作台优先打开真实裁剪样本；否则自动使用合成样本。真实样本已在 `.gitignore` 中排除，双平台 ZIP 打包脚本也默认排除它；发布前须单独确认数据分享权限。

本机可选的真实示例来自 `20250210-jianshazui` 的 Ladybug 全景帧 `001298`。`scripts/prepare_vmms_sample.py` 读取本机 TREE 项目的 `frame_coordinates.csv`，用该帧的插值 INS 位姿把相机附近 42 m 的映射点云变换为相机局部系，再从附近的降采样 PCD 中选取最多 100,000 点。处理后文件位于 `public/sample-cloud.pcd`、`public/sample-panorama.jpg` 和 `public/sample-metadata.json`。脚本只读取原始数据，不修改原目录。

局部坐标约定为 **+X 向右、+Y 向上、−Z 向前**。与 TREE 的 Ladybug 球面投影约定对应：

```text
u = 0.5 − atan2(left, forward) / (2π)
v = 0.5 − asin(up / distance) / π
```

这一初始配准由平台 INS 位姿和周边映射点云生成。现有数据中没有经过独立标定的 LiDAR 到 Ladybug 杆臂及安装角，因此它是**粗配准**；投影叠加用于人工检查，界面中的位置和角度调节可补偿局部偏差。示例点云是站点周围的局部抽样，不能代表整份原始多 GB 点云或严格同一时刻的单帧扫描。

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
- `src/modelRegistry.ts`、`src/modelApi.ts`、`src/prelabel.ts`：模型配置、协议校验和 HTTP 适配器。
- `src/distillation.ts`、`src/distillationContract.ts`、`src/distillationClient.ts`：已审核训练清单、蒸馏服务类型与客户端接口。
- `scripts/prepare_vmms_sample.py`：内置真实样本预处理。

当前标注工具是界面和数据契约原型：3D 框支持水平旋转，全景支持点和多边形，点云支持手工逐点分类；框选拟合仅提供初值，混杂背景时需要人工修正。逐点分类依据导入后点的索引，重新采样同一文件后索引可能变化。尚无自动地面分离、平面检测、连通组件分割、跨视图自动关联、精配准求解、批量任务持久化、多人协作或内置真实模型；推理须连接外部兼容服务。
