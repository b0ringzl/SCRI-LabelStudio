# 协作开发

本仓库保持一份 React/Three.js 源码，始终从同一次构建产出 Windows 和 macOS 两个交付包。请在自己的分支修改代码，通过 Pull Request 合并，避免维护功能不同步的两个代码副本。

当前 900 张道路设施图片的复核入口与七类 YOLO 规则见 [道路设施复核说明](docs/ROAD_FURNITURE_REVIEW.md)。不要把 `label/data` 的真实 JPG、TXT、JSON 或 PPTX 复制进仓库或交付 ZIP；复核结果用工作台导出的 YOLO ZIP 交接。

## 开发与交付

1. 安装 Node.js 20+ 和 Python 3。
2. `npm ci` 安装锁定依赖。
3. `npm run dev` 启动本机开发服务，使用终端实际显示的地址。
4. `npm run build` 检查 TypeScript 并构建静态文件。
5. `npm run test:distillation` 检查已审核样本筛选、教师来源和无效框拦截。
6. `npm run package` 生成 `release/AtlasStudio-Windows-v*.zip` 和 `release/AtlasStudio-macOS-v*.zip`。

`node_modules/`、`dist/`、`release/` 都是本机生成物，不提交。GitHub Actions 会在 push 和 PR 后重新构建并上传两份交付 ZIP。Mac 启动文件在 ZIP 内保留可执行权限；如果从源码检出后需要直接运行，可使用 `sh ./Start-Atlas-macOS.command`。

## 改动点云与配准时

- 保持 `src/types.ts` 导出 JSON 的兼容性；新增字段须明确旧数据的默认解释。
- 真实样本是 INS 位姿粗配准；不要把投影叠加显示为精确传感器外参。
- 点云与全景标注共享对象 ID；任何新标注形状都应保持这一关系。
- 用仓库内的合成演示样本检查左右视图、框内点数、选区建框和全景投影；真实尖沙咀数据仅在获得授权后另行分享。
- 不要提交原始多 GB 点云、设备私有路径、密钥或由外部项目复制来的源码。

模型同事先读 [预标注服务接口](docs/MODEL_API.md)与[模型切换说明](docs/MODEL_SWITCHING.md)，界面同事先读 [UI 设计说明](docs/UI_DESIGN.md)。新增模型输出不要直接覆盖人工标注；预测结果需要审核步骤。可用 `node examples/mock-model-server.mjs` 验证两个图片模型和一个点云／全景模型的切换。

实现学生训练服务的同事请先读 [蒸馏接口 v1.0](docs/DISTILLATION_API.md)。前端目前只导出**已确认**图片的训练清单；服务端负责影像集上传、不可变数据快照、异步训练与独立人工真值评估。不要把普通 YOLO 复核进度 ZIP 中的未确认任务直接用于训练，也不要把云模型 Key 或真实影像提交到仓库。
