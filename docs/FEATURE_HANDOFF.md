# SCRI Labeling 功能与协作交接

本页是团队主线成果的公开功能清单。公开贡献在功能分支完成，提交 PR 到本仓库 main，由维护者审核并同步到团队主线。项目使用一套 React/TypeScript 源码，同时生成 Windows 和 macOS 交付包。

## 功能清单

| 模块 | 已实现的行为 | 主要代码与说明 |
| --- | --- | --- |
| 项目与任务 | Label Studio 风格导航；管理点云、全景和可选相机位姿组成的配对任务；类别在两视图共享。 | `src/App.tsx`、`src/types.ts`、[UI 架构](UI_ARCHITECTURE.md) |
| 联合标注工作台 | 左侧 PCD/PLY 点云，右侧 2:1 等距柱状全景；对象共用 `OBJ-*` ID，两侧分别绘制后可人工关联。 | `src/PointCloudView.tsx`、`src/PanoramaView.tsx`、[UI 设计](UI_DESIGN.md) |
| 点云 3D 框 | 单击建立初始框，矩形选区拟合；选中框后拖手柄移动、调整尺寸或水平旋转；可切换视角、聚焦及点大小，也可精确输入框参数。 | `src/boxFitting.ts`、`src/PointCloudView.tsx`、[标注操作](labeling-workflow.md) |
| 逐点类别 | 笔刷涂抹、框选、擦除和撤销；按原始点索引保存类别并随联合标注 JSON 导出。 | `src/PointCloudView.tsx`、`src/types.ts` |
| 全景标注 | 球面环视；在全景上标点或多边形；可在同一个对象上关联点云形状。 | `src/PanoramaView.tsx`、`src/App.tsx` |
| 配准核验 | 导入相机→点云矩阵或逐帧 INS×相机硬件外参；彩色点云可估 yaw 候选；四对以上同名点求每帧六自由度位姿；投影叠加供核验。 | `src/registrationIO.ts`、`src/registrationMath.ts`、`src/autoYaw.ts`、[工作流](REGISTRATION_WORKFLOW.md) |
| NID 自动精配准 | 无权重 CPU 球面 NID 六自由度局部优化；当前/全部帧、取消、候选预览、原位姿对比、应用/舍弃。需已有粗位姿和有效强度/真实 RGB，候选仍须独立核验。 | `src/automaticRegistration.ts`、`scripts/registrationGateway.mjs`、`scripts/registration_worker.py`、[部署与 API](AUTOMATIC_REGISTRATION.md) |
| DA² 深度辅助配准（0.16.0） | 单张全景生成相对深度，结合实际 XYZ 点云与粗位姿求局部尺度/外参候选；支持深度查看、与 NID 切换和人工确认。拒绝结果保留原位姿。 | `src/depthRegistration.ts`、`scripts/depth_worker.py`、`scripts/depth_geometry.py`、[模型与 UI 接入手册](DEPTH_REGISTRATION.md) |
| DA² 配对测试套件 | 四组真实场景、32 帧的本地制作工具；双平台启动器、逐文件校验清单与五帧参考计划。GitHub 仅提交工具与指南，测绘数据包本地生成。 | `scripts/package_depth_test_suite.py`、`examples/registration/depth-test-plan.json`、[测试步骤与文件说明](DEPTH_TEST_SCENES.md) |
| 连续全景定位 | 在相邻帧以同一对象 ID 框定目标，按逐帧位姿三角交会；检查基线、视差、射线偏差与点云距离，再生成待人工核验的 3D 候选框。 | `src/RegistrationWorkflow.tsx`、`src/App.tsx`、[工作流](REGISTRATION_WORKFLOW.md) |
| 道路设施图片复核 | 导入 `data_for_annotation` 的 JPG/YOLO TXT；按七类规则增删、移动、缩放 2D 框，改类别，提示疑似重复；逐张确认，保存本机进度，导入/导出 YOLO ZIP。 | `src/ImageReview.tsx`、`src/reviewData.ts`、[批次说明](ROAD_FURNITURE_REVIEW.md) |
| 可切换模型接口 | 保存多个图片或配对任务的 HTTP 模型配置；上传资产、运行预测、校验结果；候选由人工接受后才成为正式标注。附 mock 服务供联调。 | `src/modelRegistry.ts`、`src/modelApi.ts`、`src/prelabel.ts`、`examples/mock-model-server.mjs`、[接口契约](MODEL_API.md) |
| 千问与 DeepSeek | 同源本机网关读取环境变量中的 Key 和允许模型；向兼容视觉 API 发送当前图片或全景；返回 2D 候选，按提供方切换并人工审核。 | `scripts/llmGateway.mjs`、[接入说明](LLM_PROVIDERS.md) |
| 蒸馏接口 | 只从已确认图片导出带教师来源的 2D 硬标签清单；定义外部影像集、数据集、训练任务与状态 API，并提供 TypeScript 客户端。 | `src/distillation.ts`、`src/distillationContract.ts`、`src/distillationClient.ts`、[蒸馏契约](DISTILLATION_API.md) |
| 双平台交付 | 本机启动脚本启动环回地址网页；同一次构建生成 Windows 与 macOS ZIP；Actions 在 push/PR 后测试、构建并上传两个包。 | `Start-Atlas-Windows.bat`、`Start-Atlas-macOS.command`、`scripts/package_release.py`、`.github/workflows/build.yml` |

## 数据与能力边界

- 仓库只包含合成演示点云与全景。`label/data` 的真实图片、标签、PPTX、尖沙咀原始数据、本机配置、密钥、`node_modules`、`dist` 和 `release` 均不提交。常规应用 ZIP 不包含真实数据；另行在本地制作的配对测试套件含用户数据，仅用于本地或获准的私有共享。
- 尖沙咀样本仍是 INS 粗配准，没有独立标定的 LiDAR 到相机外参。颜色朝向只估 yaw；NID 与 DA² 后端可在粗位姿附近求六自由度候选，均不代表无初值全局配准。低内部残差不等于测量真值。多帧定位仍需核验目标身份与点云框；大规模空间索引和可靠的全自动外参标定仍需后续工作。
- 千问和 DeepSeek 接口仅从影像生成 2D 区域候选；不会直接生成可信的点云 3D 框或逐点标签。真实推理须由使用者配置有效服务与 Key，仓库不含模型权重。
- 蒸馏版本只交付已审核标签清单和外部训练服务契约；影像上传页面、训练后端、效果评估执行和自动部署尚未实现。训练效果需要独立人工真值集验证。
- 当前批次目录只包含普通 JPG 与 2D YOLO 标签，不包含点云或同步全景；其复核页与联合标注工作台是两个入口。

## 开发和验证

1. 安装 Node.js 20+ 与 Python 3，运行 `npm ci`。
2. 运行 `npm run test:llm`、`npm run test:distillation`、`npm run test:registration`、`npm run build`、`npm run package`。
3. 检查 `release/AtlasStudio-Windows-v*.zip` 和 `release/AtlasStudio-macOS-v*.zip`；分别按 [Windows 启动说明](README-Windows.md)与[macOS 启动说明](README-macOS.md)启动。
4. 在同一个 PR 中描述两平台验证情况、数据/接口兼容性以及仍需同事完成的服务。GitHub Actions 上传的 ZIP 是 PR 构建产物，不写入 Git 仓库。

## 协作入口

- UI/标注交互：[UI 设计](UI_DESIGN.md)、[UI 架构](UI_ARCHITECTURE.md)、[标注操作](labeling-workflow.md)。
- 多帧配准：[操作与矩阵格式](REGISTRATION_WORKFLOW.md)、[TREE 经验迁移](TREE_REGISTRATION_TRANSFER.md)。
- 模型与 LLM：[预标注接口](MODEL_API.md)、[模型切换](MODEL_SWITCHING.md)、[千问/DeepSeek](LLM_PROVIDERS.md)。
- 训练服务：[蒸馏接口](DISTILLATION_API.md)。
- 代码提交：[贡献指南](../CONTRIBUTING.md)。
