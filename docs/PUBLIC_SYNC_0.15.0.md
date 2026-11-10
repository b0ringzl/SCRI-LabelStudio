# 公开版 v0.15.0 同步说明

此版本以团队已审核的 0.15.0 文件快照同步，基于公开仓库原有 main 新建提交，不导入团队私有仓库的 Git 历史，不强制覆盖公开分支。

## 同步功能

- 数据 → 配准 → 标注 → 训练的四步工作台，点云与全景分屏/投影叠加、双向视角同步、逐帧位姿导入。
- 无权重 CPU 球面 NID 六自由度局部自动精配准；当前/批量、取消、候选对比、应用/舍弃。需要粗位姿，候选仍须独立核验，尚未证明真实误差 ≤4°。
- 同名点精调、多帧目标轮廓、顶点编辑和撤销、带厚度物体的 3D 候选与人工纠错。
- 可切换 HTTP 辅助标注、千问与 DeepSeek 本机网关、审核后蒸馏数据接口；真实训练服务仍需团队实现。
- Windows/macOS 独立安装与启动器、同一次构建的两平台 ZIP、两份各 30 页且带 10 张操作图解的 PDF。

## 公开范围

包含源码、测试、协议、操作文档与合成演示资产。排除真实点云/全景/标注数据、视频工程中的私有截图和成片、密钥、本机配置、虚拟环境、依赖目录和本机生成缓存。手册截图使用合成教学建筑；示例位姿不是真实设备标定。

公开提交保留原有公开历史。团队源码与公开源码相同，公开版仅增加此说明、调整贡献入口、移除未公开视频链接并强化忽略规则；没有为公开版分叉算法或接口。

## 运行与维护

源码首次 `npm ci`，然后 `npm run build`、`npm run serve`。安装自动配准环境：Windows 运行 `Setup-Registration-Windows.bat`，macOS 运行 `sh ./Setup-Registration-macOS.command`。详情见 [自动配准说明](AUTOMATIC_REGISTRATION.md)。

`npm run package` 同时生成 `release/AtlasStudio-Windows-v0.15.0.zip` 与 `release/AtlasStudio-macOS-v0.15.0.zip`；GitHub Actions 也会生成两平台 artifacts。ZIP 不写入 Git 历史。PDF 原稿与两平台文件见 [独立手册](manuals/README.md)。

模型同事阅读 [模型协议](MODEL_API.md)、[千问/DeepSeek](LLM_PROVIDERS.md)、[蒸馏接口](DISTILLATION_API.md)；界面同事阅读 [UI 设计](UI_DESIGN.md)和 [UI 架构](UI_ARCHITECTURE.md)。请在 PR 中说明两平台验证结果与能力限制。
