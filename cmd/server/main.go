package main

import (
	"flag"
	"fmt"
	"log"

	"agent-evaluation/internal/api"
	"agent-evaluation/internal/db"
	"agent-evaluation/internal/engine"
	"agent-evaluation/web"
)

var (
	// Version 运行时版本号，通过构建脚本 -ldflags "-X main.Version=..." 注入
	Version = "dev"
	// GitCommit Git 提交哈希
	GitCommit = "none"
	// BuildTime 编译构建时间戳
	BuildTime = "unknown"
)

func main() {
	port := flag.Int("port", 8080, "HTTP 服务监听端口")
	dbPath := flag.String("db", "data/eval.db", "SQLite 数据库文件路径")
	showVersion := flag.Bool("version", false, "显示版本信息并退出")
	showVersionShort := flag.Bool("v", false, "显示版本信息并退出 (简写)")
	flag.Parse()

	if *showVersion || *showVersionShort {
		fmt.Printf("agent-eval-server %s (commit: %s, built at: %s)\n", Version, GitCommit, BuildTime)
		return
	}

	log.Printf("[Main] 正在启动 Agent 评测系统服务 (版本: %s, 提交: %s)...", Version, GitCommit)

	// 1. 初始化 SQLite 数据库与种子数据
	database, err := db.InitDB(*dbPath)
	if err != nil {
		log.Fatalf("[Main] 数据库初始化失败: %v", err)
	}

	// 打印预置账号与密码到控制台
	db.PrintPresetCredentials(database)

	// 2. 初始化任务调度执行器
	runner := engine.NewTaskRunner(database)

	// 3. 处理内嵌静态文件系统
	staticFS, err := web.GetDistFS()
	if err != nil {
		log.Printf("[Main] 提取内嵌前端静态资源失败: %v", err)
		staticFS = nil
	}

	// 4. 初始化路由
	router := api.SetupRouter(database, runner, staticFS)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("[Main] 服务已就绪，正在监听 %s", addr)
	log.Printf("[Main] 访问控制台: http://localhost:%d", *port)

	if err := router.Run(addr); err != nil {
		log.Fatalf("[Main] 服务启动失败: %v", err)
	}
}
