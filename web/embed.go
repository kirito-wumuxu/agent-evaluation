package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distEmbedFS embed.FS

// GetDistFS 获取内嵌的前端编译资源文件系统
func GetDistFS() (fs.FS, error) {
	return fs.Sub(distEmbedFS, "dist")
}
