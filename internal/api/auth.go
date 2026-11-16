package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// JWTClaims 会话载荷
type JWTClaims struct {
	UID    uint   `json:"uid"`
	OpenID string `json:"open_id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Exp    int64  `json:"exp"`
}

// SignJWT 基于 HMAC-SHA256 生成 JWT Token
func SignJWT(claims JWTClaims, secret string) (string, error) {
	headerJSON, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payloadJSON, _ := json.Marshal(claims)

	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)

	unsignedToken := headerB64 + "." + payloadB64

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsignedToken))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return unsignedToken + "." + sigB64, nil
}

// VerifyJWT 验证 HMAC-SHA256 JWT Token 并解析 Claims
func VerifyJWT(tokenStr string, secret string) (*JWTClaims, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, errors.New("无效的令牌格式")
	}

	unsignedToken := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsignedToken))
	expectedSig := mac.Sum(nil)

	actualSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(actualSig, expectedSig) {
		return nil, errors.New("令牌签名验证失败")
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("令牌载荷解析失败")
	}

	var claims JWTClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, errors.New("令牌载荷反序列化失败")
	}

	if claims.Exp < time.Now().Unix() {
		return nil, errors.New("登录已过期，请重新登录")
	}

	return &claims, nil
}

// AuthHandler 认证与飞书 SSO 控制器
type AuthHandler struct {
	db *gorm.DB
}

// NewAuthHandler 构造函数
func NewAuthHandler(db *gorm.DB) *AuthHandler {
	return &AuthHandler{db: db}
}

// getAuthConfig 获取系统配置中的认证参数
func (h *AuthHandler) getAuthConfig() (appID, appSecret, redirectURI, ssoEnabled, jwtSecret string) {
	var configs []model.SystemConfig
	h.db.Find(&configs)

	cfgMap := make(map[string]string)
	for _, c := range configs {
		cfgMap[c.Key] = c.Value
	}

	appID = cfgMap["feishu_app_id"]
	appSecret = cfgMap["feishu_app_secret"]
	redirectURI = cfgMap["feishu_redirect_uri"]
	ssoEnabled = cfgMap["feishu_sso_enabled"]
	jwtSecret = cfgMap["jwt_secret"]
	if jwtSecret == "" {
		jwtSecret = "agent-eval-jwt-secret-fallback"
	}
	return
}

// GetConfig 获取当前 SSO 配置状态 (公开接口，不泄露 secret)
func (h *AuthHandler) GetConfig(c *gin.Context) {
	appID, _, redirectURI, ssoEnabled, _ := h.getAuthConfig()
	configured := appID != ""

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"feishu_sso_enabled": ssoEnabled == "true",
			"feishu_app_id":      appID,
			"configured":         configured,
			"redirect_uri":       redirectURI,
		},
	})
}

// GetFeishuAuthURL 获取飞书 OAuth 授权跳转 URL
func (h *AuthHandler) GetFeishuAuthURL(c *gin.Context) {
	appID, _, redirectURI, _, _ := h.getAuthConfig()
	if appID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "系统尚未配置飞书 App ID，请先在系统设置中配置"})
		return
	}

	state := c.DefaultQuery("state", fmt.Sprintf("%d", time.Now().UnixNano()))
	customRedirect := c.Query("redirect_uri")
	if customRedirect != "" {
		redirectURI = customRedirect
	}

	if redirectURI == "" {
		// 默认回跳到当前域名的后端回调地址
		scheme := "http"
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		redirectURI = fmt.Sprintf("%s://%s/api/v1/auth/feishu/callback", scheme, c.Request.Host)
	}

	// 飞书网页登录标准授权 URL
	authURL := fmt.Sprintf(
		"https://open.feishu.cn/open-apis/authen/v1/index?app_id=%s&redirect_uri=%s&state=%s",
		url.QueryEscape(appID),
		url.QueryEscape(redirectURI),
		url.QueryEscape(state),
	)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"url":          authURL,
			"state":        state,
			"redirect_uri": redirectURI,
		},
	})
}

// FeishuUserInfo 飞书用户信息返回结构
type FeishuUserInfo struct {
	OpenID    string `json:"open_id"`
	UnionID   string `json:"union_id"`
	Name      string `json:"name"`
	EnName    string `json:"en_name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
	Mobile    string `json:"mobile"`
}

// exchangeFeishuUserInfo 使用授权码向飞书开放平台换取用户信息
func exchangeFeishuUserInfo(appID, appSecret, code string) (*FeishuUserInfo, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	// 1. 获取 internal app_access_token
	tokenReqBody, _ := json.Marshal(map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	})
	tokenResp, err := client.Post(
		"https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
		"application/json; charset=utf-8",
		bytes.NewBuffer(tokenReqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("请求飞书获取 app_access_token 失败: %w", err)
	}
	defer tokenResp.Body.Close()

	var appTokenRes struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		AppAccessToken string `json:"app_access_token"`
	}
	if err := json.NewDecoder(tokenResp.Body).Decode(&appTokenRes); err != nil {
		return nil, fmt.Errorf("解析飞书 app_access_token 失败: %w", err)
	}
	if appTokenRes.Code != 0 {
		return nil, fmt.Errorf("飞书认证失败 [%d]: %s", appTokenRes.Code, appTokenRes.Msg)
	}

	// 2. 使用 authorization_code 与 app_access_token 获取用户信息
	userReqBody, _ := json.Marshal(map[string]string{
		"grant_type": "authorization_code",
		"code":       code,
	})
	userReq, err := http.NewRequest(
		"POST",
		"https://open.feishu.cn/open-apis/authen/v1/access_token",
		bytes.NewBuffer(userReqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("构造获取用户 Token 请求失败: %w", err)
	}
	userReq.Header.Set("Authorization", "Bearer "+appTokenRes.AppAccessToken)
	userReq.Header.Set("Content-Type", "application/json; charset=utf-8")

	userResp, err := client.Do(userReq)
	if err != nil {
		return nil, fmt.Errorf("请求飞书换取用户信息失败: %w", err)
	}
	defer userResp.Body.Close()

	var userTokenRes struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Name        string `json:"name"`
			EnName      string `json:"en_name"`
			AvatarURL   string `json:"avatar_url"`
			AvatarThumb string `json:"avatar_thumb"`
			OpenID      string `json:"open_id"`
			UnionID     string `json:"union_id"`
			Email       string `json:"email"`
			Mobile      string `json:"mobile"`
		} `json:"data"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&userTokenRes); err != nil {
		return nil, fmt.Errorf("解析飞书用户信息失败: %w", err)
	}
	if userTokenRes.Code != 0 {
		return nil, fmt.Errorf("飞书获取用户信息错误 [%d]: %s", userTokenRes.Code, userTokenRes.Msg)
	}

	avatar := userTokenRes.Data.AvatarURL
	if avatar == "" {
		avatar = userTokenRes.Data.AvatarThumb
	}

	return &FeishuUserInfo{
		OpenID:    userTokenRes.Data.OpenID,
		UnionID:   userTokenRes.Data.UnionID,
		Name:      userTokenRes.Data.Name,
		EnName:    userTokenRes.Data.EnName,
		AvatarURL: avatar,
		Email:     userTokenRes.Data.Email,
		Mobile:    userTokenRes.Data.Mobile,
	}, nil
}

// FeishuCallback 飞书 OAuth 回跳地址 (浏览器直跳)
func (h *AuthHandler) FeishuCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" {
		c.String(http.StatusBadRequest, "缺少飞书授权 code 参数")
		return
	}

	appID, appSecret, _, _, jwtSecret := h.getAuthConfig()
	if appID == "" || appSecret == "" {
		c.String(http.StatusInternalServerError, "系统尚未配置飞书 App ID 或 App Secret")
		return
	}

	feishuUser, err := exchangeFeishuUserInfo(appID, appSecret, code)
	if err != nil {
		c.String(http.StatusInternalServerError, "飞书登录换取凭据失败: "+err.Error())
		return
	}

	user, token, err := h.upsertFeishuUserAndSign(feishuUser, jwtSecret)
	if err != nil {
		c.String(http.StatusInternalServerError, "本地注册/登录用户失败: "+err.Error())
		return
	}
	_ = user

	// 携带 token 重定向回前端首页
	redirectTarget := fmt.Sprintf("/?token=%s&state=%s", url.QueryEscape(token), url.QueryEscape(state))
	c.Redirect(http.StatusFound, redirectTarget)
}

// FeishuLogin API POST 形式换取登录凭证
func (h *AuthHandler) FeishuLogin(c *gin.Context) {
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少 code 参数"})
		return
	}

	appID, appSecret, _, _, jwtSecret := h.getAuthConfig()
	if appID == "" || appSecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "系统尚未配置飞书 App ID 或 App Secret"})
		return
	}

	feishuUser, err := exchangeFeishuUserInfo(appID, appSecret, req.Code)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "飞书授权校验失败: " + err.Error()})
		return
	}

	user, token, err := h.upsertFeishuUserAndSign(feishuUser, jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "保存用户状态失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"token": token,
			"user":  user,
		},
	})
}

// PasswordLogin 账号密码登录 (支持预置账号 admin/developer/tester)
func (h *AuthHandler) PasswordLogin(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请输入账号与密码"})
		return
	}

	var user model.User
	if err := h.db.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "账号或密码错误"})
		return
	}

	// 密码校验 (bcrypt)
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "账号或密码错误"})
		return
	}

	_, _, _, _, jwtSecret := h.getAuthConfig()
	token, err := SignJWT(JWTClaims{
		UID:    user.ID,
		OpenID: user.OpenID,
		Name:   user.Name,
		Role:   user.Role,
		Exp:    time.Now().Add(7 * 24 * time.Hour).Unix(),
	}, jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "生成登录令牌失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"token": token,
			"user":  user,
		},
	})
}

// DevLogin 本地快速登录 (免密/演示/调试通道)
func (h *AuthHandler) DevLogin(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
		Role string `json:"role"`
	}
	_ = c.ShouldBindJSON(&req)

	if req.Name == "" {
		req.Name = "评测管理员"
	}
	if req.Role == "" {
		req.Role = "admin"
	}

	var user model.User
	err := h.db.Where("name = ?", req.Name).First(&user).Error
	if err != nil {
		user = model.User{
			Name:      req.Name,
			Role:      req.Role,
			Email:     "dev@local",
			AvatarURL: fmt.Sprintf("https://api.dicebear.com/7.x/bottts/svg?seed=%s", url.QueryEscape(req.Name)),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if err := h.db.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "创建本地用户失败: " + err.Error()})
			return
		}
	}

	_, _, _, _, jwtSecret := h.getAuthConfig()
	token, err := SignJWT(JWTClaims{
		UID:    user.ID,
		OpenID: user.OpenID,
		Name:   user.Name,
		Role:   user.Role,
		Exp:    time.Now().Add(7 * 24 * time.Hour).Unix(),
	}, jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "生成令牌失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"token": token,
			"user":  user,
		},
	})
}

// GetMe 获取当前登录用户信息
func (h *AuthHandler) GetMe(c *gin.Context) {
	uVal, exists := c.Get("currentUser")
	if !exists || uVal == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "未登录或登录已过期"})
		return
	}

	user := uVal.(*model.User)
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": user,
	})
}

// upsertFeishuUserAndSign 注册或更新飞书用户并签名发放 JWT
func (h *AuthHandler) upsertFeishuUserAndSign(fu *FeishuUserInfo, jwtSecret string) (*model.User, string, error) {
	var user model.User
	err := h.db.Where("open_id = ?", fu.OpenID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 新建用户
		role := "reviewer"
		var count int64
		h.db.Model(&model.User{}).Count(&count)
		if count == 0 {
			role = "admin"
		}
		user = model.User{
			OpenID:    fu.OpenID,
			UnionID:   fu.UnionID,
			Name:      fu.Name,
			EnName:    fu.EnName,
			AvatarURL: fu.AvatarURL,
			Email:     fu.Email,
			Mobile:    fu.Mobile,
			Role:      role,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if err := h.db.Create(&user).Error; err != nil {
			return nil, "", err
		}
	} else if err != nil {
		return nil, "", err
	} else {
		// 更新已有用户档案
		user.Name = fu.Name
		user.EnName = fu.EnName
		if fu.AvatarURL != "" {
			user.AvatarURL = fu.AvatarURL
		}
		if fu.Email != "" {
			user.Email = fu.Email
		}
		if fu.Mobile != "" {
			user.Mobile = fu.Mobile
		}
		user.UpdatedAt = time.Now()
		h.db.Save(&user)
	}

	token, err := SignJWT(JWTClaims{
		UID:    user.ID,
		OpenID: user.OpenID,
		Name:   user.Name,
		Role:   user.Role,
		Exp:    time.Now().Add(7 * 24 * time.Hour).Unix(),
	}, jwtSecret)
	if err != nil {
		return nil, "", err
	}

	return &user, token, nil
}

// AuthMiddleware 认证鉴权拦截中间件
func AuthMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var configs []model.SystemConfig
		db.Find(&configs)

		cfgMap := make(map[string]string)
		for _, cfg := range configs {
			cfgMap[cfg.Key] = cfg.Value
		}

		ssoEnabled := cfgMap["feishu_sso_enabled"] == "true"
		jwtSecret := cfgMap["jwt_secret"]
		if jwtSecret == "" {
			jwtSecret = "agent-eval-jwt-secret-fallback"
		}

		// 提取 Authorization Header 或 query token
		authHeader := c.GetHeader("Authorization")
		var tokenStr string
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		} else {
			tokenStr = c.Query("token")
		}

		if tokenStr != "" {
			claims, err := VerifyJWT(tokenStr, jwtSecret)
			if err == nil && claims != nil {
				var user model.User
				if err := db.First(&user, claims.UID).Error; err == nil {
					c.Set("currentUser", &user)
				}
			}
		}

		// 如果开启了飞书 SSO 且是受保护的 API 路由，未登录则拦截
		if ssoEnabled && strings.HasPrefix(c.Request.URL.Path, "/api/v1") {
			// 允许认证接口及专门的 OpenAPI 接口匿名通过此中间件 (OpenAPI 拥有专属鉴权守卫)
			if !strings.HasPrefix(c.Request.URL.Path, "/api/v1/auth") && !strings.HasPrefix(c.Request.URL.Path, "/api/v1/openapi") {
				if _, exists := c.Get("currentUser"); !exists {
					c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
						"code":    401,
						"message": "系统已启用飞书单点登录，请先登录系统",
					})
					return
				}
			}
		}

		c.Next()
	}
}

// RequireRoles 基于角色的细粒度访问控制 (RBAC) 中间件
// admin 始终拥有最高全量权限
func RequireRoles(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uVal, exists := c.Get("currentUser")
		if !exists || uVal == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "未登录或登录态已失效，请先登录系统",
			})
			return
		}

		user := uVal.(*model.User)
		// admin 拥有全量超级权限
		if user.Role == "admin" {
			c.Next()
			return
		}

		// 检查用户角色是否在被允许的角色列表中
		for _, r := range roles {
			if user.Role == r {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"code":    403,
			"message": fmt.Sprintf("权限不足：当前角色 [%s] 无权访问或执行该操作", user.Role),
		})
	}
}
