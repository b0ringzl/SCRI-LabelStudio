# 0.10.3 · 真实单场景试用

## 功能及代码入口

1. **提取点云与连续原始全景**：新增 `scripts/prepare_trial_scene.py`，验证 PCD 长度，分块裁剪/抽样 RGB 点，复制原始 JPG，生成逐帧 INS 位姿、来源元数据、预览与 SHA-256 清单；拒绝覆盖旧场景。
2. **本机只读场景入口**：新增 `scripts/localSceneGateway.mjs`。`scripts/serve.mjs` 支持 `--scene-dir` / `ATLAS_SCENE_DATA_DIR`，自动打开 `?localScene=1`；只开放配置目录内明确列出的点云和全景资产，沿用 localhost 绑定和端口避让。
3. **刷新恢复真实任务**：`src/App.tsx` 读取场景清单、进入配准页，恢复保存的标注和逐帧位姿；内容哈希形成任务 ID，资产或点索引变化不会混用旧标签。INS 来源显示为粗配准；恢复位姿按当前帧导入值执行。
4. **双平台完整试用包**：新增 `scripts/package_scene_trial.py`，将同一平台构建和同一场景装入 Windows/macOS ZIP，分别提供 Start-Scene 启动文件。常规 `scripts/package_release.py` 纳入本轮脚本和说明，但不打包真实数据。
5. **协作与验证**：新增 `docs/TRIAL_SCENE.md`，更新主 README 与两平台说明；新增 `scripts/test_local_scene.mjs`，覆盖 HTTP 读取、方法限制、资产白名单、任务标识稳定和数据变更隔离，纳入 CI。Windows/macOS CI 另外检查新 Python 脚本语法。

## 本次实际场景

尖沙咀 `001298` 周围 45 m，75 万 RGB 点；全景 `001278` 至 `001318` 共 11 张原始 8K 图，采样轨迹约 20.13 m。数据来自本机真实 VMMS 数据及 TREE 逐帧坐标表，输出在 Git 忽略的 `local-samples/` 和 `release/`。

当前自动精配准使用无权重球面 NID 本机后端；部署、输入条件、质量检查与限制见 [自动配准说明](AUTOMATIC_REGISTRATION.md)。已有粗位姿仍是前提，候选须人工核验。

## 验证

- Windows 本机实际提取完成；PCD 由 Three.js PCDLoader 成功解析为 750,000 点且包含 RGB；原始全景逐字节复制。
- 浏览器确认真实点云和全景左右显示、首末帧切换时位姿随帧更新、刷新重新加载真实任务。
- `npm run build`、`npm run test:local-scene`；其余既有接口回归随 PR CI 检查。
- 两平台从同一构建打包，检查 ZIP 完整性；macOS 启动文件保留可执行权限。真实场景的 macOS GUI 效果尚未在实体 Mac 上验收。

详细试用、复现和接口见 [真实场景说明](TRIAL_SCENE.md)。
