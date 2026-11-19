package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"agent-evaluation/internal/api"
	"agent-evaluation/internal/db"
	"agent-evaluation/internal/engine"
	"agent-evaluation/internal/updater"
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
	checkUpdate := flag.Bool("check-update", false, "检查是否有新版本并退出")
	autoUpdate := flag.Bool("update", false, "自动检测新版本、下载替换并升级当前可执行程序")
	proxy := flag.String("proxy", "", "GitHub 加速代理地址 (例如: https://ghproxy.net/)")
	flag.Parse()

	if *showVersion || *showVersionShort {
		fmt.Printf("agent-eval-server %s (commit: %s, built at: %s)\n", Version, GitCommit, BuildTime)
		return
	}

	if *checkUpdate {
		fmt.Printf("当前运行版本: %s (commit: %s, built at: %s)\n", Version, GitCommit, BuildTime)
		fmt.Println("正在检测 GitHub Releases 最新版本...")
		mgr := updater.NewManager("", *proxy)
		info, err := mgr.CheckUpdate(Version, true)
		if err != nil {
			fmt.Printf("检查更新失败: %v\n", err)
			os.Exit(1)
		}
		if info.HasUpdate {
			fmt.Printf("🎉 发现新版本: %s (发布时间: %s)\n", info.LatestVersion, info.PublishedAt.Local().Format("2006-01-02 15:04:05"))
			if info.ReleaseNotes != "" {
				fmt.Printf("\n更新日志:\n%s\n\n", info.ReleaseNotes)
			}
			fmt.Printf("安装包文件名: %s\n", info.AssetName)
			fmt.Printf("下载地址: %s\n", info.AssetURL)
			fmt.Println("提示: 运行 `agent-eval-server --update` 可一键完成自动下载与热替换升级。")
		} else {
			fmt.Printf("当前已是最新版本 (%s)，无需更新。\n", Version)
		}
		return
	}

	if *autoUpdate {
		fmt.Printf("当前运行版本: %s\n", Version)
		fmt.Println("正在检测 GitHub Releases 最新版本...")
		mgr := updater.NewManager("", *proxy)
		info, err := mgr.CheckUpdate(Version, true)
		if err != nil {
			fmt.Printf("检查更新失败: %v\n", err)
			os.Exit(1)
		}
		if !info.HasUpdate {
			fmt.Printf("当前已是最新版本 (%s)，无需更新。\n", Version)
			return
		}
		fmt.Printf("🎉 发现新版本: %s (发布时间: %s)\n", info.LatestVersion, info.PublishedAt.Local().Format("2006-01-02 15:04:05"))
		fmt.Printf("正在下载安装包: %s...\n", info.AssetName)
		err = mgr.ApplyUpdate(info.AssetURL, info.ChecksumSHA256, func(pct int, msg string) {
			fmt.Printf("[%3d%%] %s\n", pct, msg)
		})
		if err != nil {
			fmt.Printf("自更新失败: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("✅ 升级成功！程序已热替换更新至 %s。请重新启动服务。\n", info.LatestVersion)
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
	router := api.SetupRouter(database, runner, staticFS, Version, GitCommit, BuildTime)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("[Main] 服务已就绪，正在监听 %s", addr)
	log.Printf("[Main] 访问控制台: http://localhost:%d", *port)

	if err := router.Run(addr); err != nil {
		log.Fatalf("[Main] 服务启动失败: %v", err)
	}
}
