# macOS 自动精配准部署 · 0.15.0

已改为本机独立 CPU 后端，运行 `sh ./Setup-Registration-macOS.command` 安装，再使用该系统 Start-Atlas 启动器。

安装器仅创建 `.venv-registration`；需要 Python 3.10+、NumPy、SciPy、OpenCV headless。算法无需权重、CUDA 或 Docker。不要复用 TREE 的环境。服务只监听本机，端口冲突自动选择可用端口。

导入粗位姿 → 自动精配准当前帧/批量 → 原位姿与候选比较 → 应用或舍弃 → 同名点与独立投影核验 → 保存导出。它是六自由度局部优化，不能替代未知设备的首次标定。

完整协议、操作和四场景实测见 [自动配准说明](AUTOMATIC_REGISTRATION.md)，图解与两平台 PDF 见 [独立手册](manuals/README.md)。真实数据尚未验证 ≤4°；2/12 帧通过候选筛选不代表已通过精度验收。Windows 本机依赖和浏览器已实测，macOS 使用同一实现及 CI 检查，实体 Mac 图形性能待验收。
