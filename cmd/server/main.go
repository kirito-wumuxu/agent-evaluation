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

func main() {
	port := flag.Int("port", 8080, "HTTP 服务监听端口")
	dbPath := flag.String("db", "data/eval.db", "SQLite 数据库文件路径")
	flag.Parse()

	log.Printf("[Main] 正在启动 Agent 评测系统服务...")

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
