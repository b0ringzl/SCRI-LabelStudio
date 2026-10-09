# 2026-10-09 合并说明：道路设施复核、可切换模型与视觉 LLM

本文记录从 `codex/road-furniture-review` 合并到 `main` 的四个原始提交，按提交顺序说明代码位置、用户可见功能、数据流和边界。此前的点云／全景基础原型已通过 PR #2 进入 `main`，不在本次四个提交之内。

## 1. `2bc5573` · 道路设施 YOLO 复核工作台

**原因与输入。** 本次 `label/data/data_for_annotation` 是普通图片和现有 YOLO 2D 标签，不含点云或同步全景。程序因此新增独立的“道路设施复核”入口，并把它设为默认页；原有点云／全景工作台仍由左侧导航进入。

**改动位置与功能。**

| 位置 | 具体改动 |
| --- | --- |
| `src/App.tsx`、`src/types.ts` | 增加 `review` 页面类型、导航入口和默认路由，将图片复核与已有配对任务分开。 |
| `src/ImageReview.tsx`、`src/review.css` | 新增图片任务队列、搜索与“待确认／已确认／空标注／疑似重复”筛选；在图片上拖出新框、拖动已有框、拖四角改尺寸；支持放大、切图、删除、改类、撤销、逐张确认。右侧显示类别规则与当前框。 |
| `src/reviewData.ts` | 固定七类及其 YOLO 编号，解析／序列化归一化中心坐标和宽高；以 IoU ≥ 0.85 提示疑似重复框，**不自动删除**。 |
| `scripts/serve.mjs`、`.gitignore` | 可选从 `ATLAS_REVIEW_DATA_DIR` 或忽略提交的 `.atlas-local-data.json` 读取本机数据。`/api/review-manifest` 返回图片与 TXT 标签清单，`/api/review-image/{name}` 只读提供单张图片；限制文件名，服务仍只监听本机。 |
| `scripts/package_release.py`、`package.json`、`package-lock.json` | 两平台包纳入新增工作台，版本推进到 0.5.0；真实图片、标签和本机数据目录不打包。 |
| `docs/ROAD_FURNITURE_REVIEW.md`、`README.md`、`docs/README-Windows.md`、`docs/README-macOS.md`、`docs/UI_DESIGN.md`、`docs/MODEL_API.md`、`CONTRIBUTING.md` | 记录本批次七类、PPTX 复核规则、导入、快捷键、保存和导出方式。 |

**使用结果。** 可在本机读取 900 张 JPG、同名标签和 `class.txt`，以已有 5,442 个框作为待复核起点；也可在另一台电脑通过浏览器选择整个数据文件夹。编辑结果保存在当前浏览器；导出的 YOLO ZIP 含 `labels/*.txt`、`class.txt` 与 `review_manifest.json`，不含 JPG，不改写原始 TXT。空标签任务必须人工检查，不能自动视为“无目标”。

## 2. `3d84b0f` · 多模型切换与候选审核

**原因与目标。** 让模型服务可替换，并让预测与人工标注保持分层，避免再次运行模型时覆盖已有工作。

| 位置 | 具体改动 |
| --- | --- |
| `src/modelRegistry.ts`、`src/ModelSettings.tsx`、`src/modelSettings.css` | 新增模型配置列表，按普通图片与点云／全景两类分别选中服务；记录名称、适配器和 HTTP 根地址。配置与当前选择保存在浏览器 `localStorage`，原有单地址配置可迁移。 |
| `src/modelApi.ts`、`src/prelabel.ts`、`src/types.ts` | 图片适配器 `atlas-image-v1`：先上传当前图片到 `/assets`，再调用 `/predict`，校验七类编号与归一化 2D 框。配对适配器 `atlas-paired-v0.2`：上传当前点云和全景，再提交任务、配准、类别及点数；校验 3D 框、全景坐标、逐点索引与类别。增加超时和取消信号。 |
| `src/ImageReview.tsx`、`src/review.css` | 图片页新增模型选择、运行、取消、逐个／批量接受或忽略候选。候选用紫色虚线显示；接受后才进入正式框，并保存 `origin`、模型 ID／版本及可选分数。切图或切模型会丢弃未审核候选。 |
| `src/App.tsx`、`src/PairModelBar.tsx`、`src/pairModel.css` | 配对工作台新增模型工具条与候选清单，支持定位、接受、忽略 3D／全景对象和逐点候选。接受逐点类别时只填充尚未标注的点。 |
| `src/PointCloudView.tsx`、`src/PanoramaView.tsx` | 在两视图预览候选：点云框使用紫色虚线，逐点候选用紫色着色，全景标记单独显示；未接受前不写入正式标注。 |
| `examples/mock-model-server.mjs` | 提供本机模拟图片模型 A/B 与配对模型，用于验证切换和审核流程，不执行真实推理。 |
| `docs/MODEL_SWITCHING.md`、`docs/MODEL_API.md`、`docs/UI_ARCHITECTURE.md`、`docs/UI_DESIGN.md`、`README.md`、两平台说明及打包脚本 | 公开两个适配协议、状态流、协作分工和测试方式；版本推进到 0.6.0。 |

**运行边界。** 只有点击“运行当前图片／配对任务”才向选中服务上传当前任务文件。图片模型与配对模型的输出格式不同，不能仅改 URL 就把任意模型当作兼容服务。预测不直接覆盖已有框、配准或逐点人工标签；配对对象接受后仍须保存或导出。

## 3. `33f5282` · 千问与 DeepSeek 视觉适配器

**原因与目标。** 在标准 HTTP 检测模型之外，允许使用千问或 DeepSeek 的视觉模型生成 2D 候选，并使 API Key 留在本机进程中。

| 位置 | 具体改动 |
| --- | --- |
| `src/modelRegistry.ts`、`src/ModelSettings.tsx` | 增加 `qwen-vl-v1` 与 `deepseek-vision-v1` 两种适配方式；UI 可按图片／配对数据分别保存模型名称并切换。浏览器配置不保存 Key 或上游服务地址。 |
| `src/modelApi.ts` | 当前图片按比例缩放至最长边 1600 像素，编码为 JPEG；向同源 `/api/llm/predict` 发送提供方、模型名、当前类别和图像。再次检查返回类别与归一化边界；普通图片的类别 ID 转换为本批次 YOLO 编号。 |
| `scripts/llmGateway.mjs`、`scripts/serve.mjs` | 新增本机代理。仅接收 `127.0.0.1` 同源 POST；千问与 DeepSeek 分别读取各自 Key、允许模型列表和上游地址；向兼容 `/chat/completions` 发送视觉消息。请求上限 10 MB，模型调用超时 120 秒；只接受最多 100 个、类别和坐标均有效的 JSON 候选。上游错误不会直接作为标注写入。 |
| `src/App.tsx`、`src/PairModelBar.tsx` | 配对任务使用视觉 LLM 时只读取并发送当前全景，将 2D 框转换成全景多边形候选；**不上传点云、不制造 3D 框或逐点类别**。标准配对模型仍使用点云＋全景协议。 |
| `scripts/test_llm_gateway.mjs`、`.github/workflows/build.yml` | 加入本机模拟上游测试，覆盖两家提供方、密钥隔离、模型白名单、无效输出和跨源拒绝；CI 构建前运行该测试。 |
| `docs/LLM_PROVIDERS.md`、`docs/MODEL_API.md`、`docs/MODEL_SWITCHING.md`、`README.md`、两平台说明及 `scripts/package_release.py` | 记录 Windows/macOS 环境变量、数据传输范围、接口字段和限制；两平台交付包都包含代理模块与说明；版本推进到 0.7.0。 |

**配置举例。** 千问使用 `DASHSCOPE_API_KEY`、`ATLAS_LLM_BASE_URL`、`ATLAS_LLM_MODELS`；DeepSeek 使用 `DEEPSEEK_API_KEY`、可选 `ATLAS_DEEPSEEK_BASE_URL` 和 `ATLAS_DEEPSEEK_MODELS`。只有配置 Key 并从相同终端启动本机服务后才能真正调用模型。真实模型定位精度尚未在本批次数据上验证；候选仍须人工复核。完整命令见 [视觉 LLM 接入说明](LLM_PROVIDERS.md)。

## 4. `7ec748b` · 更新界面架构与模型协作文档

此提交只修改文档，不改变运行代码：

- `docs/UI_DESIGN.md`：解释模型表单新增的三种适配方式、影像／全景候选呈现方式、Key 的本机存放位置，并明确使用 LLM 代理时应启动构建后的本机服务。
- `docs/UI_ARCHITECTURE.md`：画清浏览器适配层与本机代理的职责；说明全景 LLM 候选不会自动与点云 3D 对象关联。
- `docs/MODEL_SWITCHING.md`：更新模型能力与限制，说明仓库不附带权重，而视觉 LLM 可连接用户自行配置的云端服务。

## 合并验证与交付

- 在同一分支运行 `npm run test:llm`、`npm run build`、`npm run package`；构建工作流也会运行测试、构建及双平台打包。
- Windows 与 macOS 使用同一份前端构建，分别由 `.bat` 与 `.command` 启动。`release/` 中的 ZIP 是生成物，不提交到 Git；GitHub Actions 会上传两种平台的 ZIP artifact。
- 真实道路设施图片／标签、真实点云／全景、模型 Key、本机 `.atlas-local-data.json` 均不在提交或交付包中。协作者可按各平台说明加载自己的数据与凭据。
