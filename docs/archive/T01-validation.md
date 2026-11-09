# T01 脚手架验证

范围按用户指令为 Next.js App Router + Cloudflare Workers + astryx 入口 CSS，AGENTS.md 不变，不代替原任务的人签字。

- 红：入口/CSS、Workers入口资源及固定技术栈三项测试均因目标文件不存在失败，再实现到绿。
- 绿：脚手架规则与架构扫描；TypeScript；Next.js/OpenNext Workers 构建。
- astryx：由 build 推荐的 AppShellContentOnly 块模板起步，保留 contentPadding=6 与 gap=4；移除内联样式并使用组件默认高度；未引入自定义CSS、布局裸标签或StyleX编译器。
- 服务层/jobs/migrations 仅建目录，没有数据库写入、业务API、鉴权捷径或种子脚本。完整业务规则测试属于 T03。
- 依赖固定版本并生成 package-lock.json。Wrangler 升至兼容4.x更新后，npm audit 剩5项（4 high、1 moderate），均在 OpenNext 的 glob/minimatch 构建依赖链；普通 audit fix 无解，force 会降级适配器至0.3.0，因此保留官方当前适配器，不执行破坏性降级。后续升级需复验。
- doctor 无失败，未安装额外主题包提示 warning；使用 core 自带默认样式。

未运行部署；等待人审合并。

最终运行检查：Wrangler 4.158.0 本地首页 HTTP 200，首页初始化文案正确，两份 CSS 资源 HTTP 200；doctor 对 .next 与项目源码检查均无失败，源码 purity 检查通过。服务已停止。
