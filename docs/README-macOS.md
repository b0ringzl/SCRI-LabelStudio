# Atlas Studio · macOS 版

独立配准操作手册已随包附在 `docs/manuals/Registration-Manual-macOS.pdf`（第 2 版，30 页、10 张操作图解，2026-11-08 修订），原稿为 `docs/REGISTRATION_MANUAL.md`。从导入到选点、纠错、求解、核验、备份和位姿重新导入，可按图中编号箭头操作。

0.14.1 有厚度的墙体请选择“完整物体（含侧面）”，逐帧圈整个外轮廓，包含正面与侧面，再生成并核验体积候选。旧正面轮廓按单面处理，不能直接当作墙厚。详见 `docs/WALL_VOLUME_0.14.1.md` 与 `docs/CHANGELOG_0.14.1.md`。

0.14.0 多帧目标框支持逐点轮廓，完成前后都能拖动、增删顶点、撤销重做；全景多边形同步升级。沿目标边缘点选后按 Enter/Return 完成，换帧保持同一对象，再多帧定位。修改轮廓会清除旧 3D 候选。Windows 使用 Ctrl+Z / Ctrl+Shift+Z，macOS 使用 Cmd+Z / Cmd+Shift+Z。完整操作和算法边界见 `docs/PANORAMA_CONTOUR_EDITING.md`，逐项变化见 `docs/CHANGELOG_0.14.0.md`。

0.13.1 关闭“视角同步”后保留当前位置、朝向与缩放，从同一画面继续独立观察；俯视/正视等预设改为主动选择。重新开启同步恢复当前帧的同步相机。详见 `docs/CHANGELOG_0.13.1.md`。共用同一实现，实体 Mac 图形表现待验收。

0.13.0 将 Demo 重排为“数据 → 配准 → 标注 → 训练”，模型与标签统一放入项目设置。配准与标注各自独立，点径可调、点云窗口可全宽显示。数据卡片替代旧验证场景下拉框。双源导入在“数据 → 导入数据”，150 MiB 为浏览器直读阈值，大源文件使用本机 Import-Scene 启动器。完整操作与功能边界见 `docs/WORKFLOW_UI_0.13.0.md`。

0.12.0 增加通用数据导入和四场景验证。新数据可运行 `sh ./Import-Scene-macOS.command "DATASET_FOLDER"`（需要 Python 3.10+ 和 Node.js 20+），自动建立独立 Python 环境，读取本组 DenseMap、全景和 CameraPoseInSlam 位姿并打开平台。含四场景的本地试用包运行 `sh ./Start-Suite-macOS.command`。尖沙咀补齐全部 12 个 DS 分块概览，总约 622 万点；32 帧在 Windows 完成同步测试。使用已有位姿的粗初始化不等于未知数据的自动标定，未证明 4° 精度。macOS 共用相同源码并跑 CI 回归，实体 Mac 的 GPU 性能待验收。详见 `docs/SCENE_IMPORT_VALIDATION.md`。

0.11.0 更新同步配准工作台：默认从当前全景相机位置看点云，拖动和缩放双向同步，可切换全宽投影。真实试用包增加至 450 万点，参数折叠；按“粗配准 → 同名点精调 → 投影核验”操作，见 `docs/SYNCHRONIZED_REGISTRATION.md`。Windows 已实测，实体 Mac 图形性能待验收。

0.10.3 增加 `--scene-dir` 只读场景入口，可自动打开连续全景与点云并在刷新后恢复已保存任务。含真实数据的独立试用包请运行 `Start-Scene-macOS.command`，或 `sh ./Start-Scene-macOS.command`；常规 GitHub 平台包仍只含合成样本。详见 `docs/TRIAL_SCENE.md` 和 `docs/CHANGELOG_0.10.3.md`。此场景在 Windows 实测，macOS 图形界面待实体机器验收。

0.10.2 增加独立的外参候选验证工具与 `Validate-Extrinsics-macOS.command`。在单独 Python 环境中读取 VMMS、INS 表和六自由度 CSV，可对照方向、单位和轴约定；不会自动修改工作台位姿。依赖与复现命令见 `docs/EXTRINSICS_VALIDATION.md`。本轮真实数据试验在 Windows 完成，macOS 使用相同代码与合成文件 CI 测试。

## 本地打开

1. 安装 Node.js 20 或更新版本。
2. 解压整个 ZIP，双击 `Start-Atlas-macOS.command`。也可以在终端进入解压目录后运行 `sh ./Start-Atlas-macOS.command`。
3. 脚本会在默认浏览器中打开工作台。保持终端窗口运行；按 Ctrl+C 结束。

此版本已经包含构建好的界面与可共享的合成演示样本，不需要另行安装 npm 依赖，也不会修改其他项目。GitHub 构建不包含本次真实道路设施数据或此前的真实点云与全景样本。服务只监听本机 `127.0.0.1`，默认尝试端口 43127；若被占用会自动尝试后续端口，并在终端显示实际地址。关闭终端后地址失效，重新运行脚本即可。

默认首页是“数据管理”。选择“普通图片 + YOLO”，展开“导入数据”并点击“选择数据文件夹”并选择整个 `data_for_annotation`（含 `images/`、`labels/`、`class.txt`）；检查 900 张图片的已有 YOLO 框后，导出新的 YOLO ZIP。真实道路设施数据不在安装包中，也不会修改原始文件。操作与七类规则见仓库 `docs/ROAD_FURNITURE_REVIEW.md`。

若要试用辅助模型，在“项目设置 → 模型服务”添加与任务类型匹配的 HTTP 服务，再返回标注页选择并运行。预测先显示为候选，需人工接受。包内 `docs/MODEL_SWITCHING.md` 和 `docs/MODEL_API.md` 说明配置及协议；没有附带真实模型。

也可接入千问或 DeepSeek 视觉模型。先按 `docs/LLM_PROVIDERS.md` 在 Terminal 设置对应 Key、服务根地址及允许的模型名，再从同一终端启动 `.command`；在配置页选择对应提供方。Key 不写入浏览器或交付包。

人工确认图片后，可在“训练”页点击“导出训练清单”，得到仅含已确认样本和教师来源的 JSON。原图需另外提供给训练服务；此包不执行学生模型训练。服务接口、评估隔离和数据格式见 `docs/DISTILLATION_API.md`。

选中 3D 框后可在点云左下角拖动“移动 / 尺寸 / 旋转”手柄；“定位到框”便于精修。视频式逐点分类可用“点云涂抹”：选类别后拖动，Shift 框选，Option（Alt）擦除，支持撤销。导出 JSON 同时包含对象框与逐点类别。

当前自动精配准使用无权重球面 NID 本机后端；部署、输入条件、质量检查与限制见 [自动配准说明](AUTOMATIC_REGISTRATION.md)。已有粗位姿仍是前提，候选须人工核验。

如果浏览器没有自动弹出，复制终端中 `Atlas Studio 已启动：` 后面的完整地址，在浏览器中打开。

## 参与开发

从 GitHub 克隆源码后运行 `npm ci`、`npm run dev`。开发服务器也只监听本机，并在端口占用时换端口。构建和生成两平台交付包分别使用 `npm run build`、`npm run package`（打包需要 Python 3）。

## 0.15.0 自动精配准

先运行 `sh ./Setup-Registration-macOS.command`，再正常启动。只安装本项目独立 Python CPU 环境，无需模型权重。导入粗位姿后，在“配准 → 粗配准 → 自动精配准”生成候选，再比较原位姿、应用或舍弃。详见 docs/AUTOMATIC_REGISTRATION.md。
