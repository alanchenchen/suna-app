package webassets

import "embed"

// Files 保存构建时暂存的前端静态资源。
//
//go:embed all:dist
var Files embed.FS
