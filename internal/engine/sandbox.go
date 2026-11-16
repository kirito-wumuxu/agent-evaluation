package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// SandboxManager 管理 Goja 虚拟机沙箱环境
type SandboxManager struct {
	client *http.Client
}

// NewSandboxManager 创建沙箱管理器
func NewSandboxManager() *SandboxManager {
	return &SandboxManager{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// GlobalSandbox 默认单例
var GlobalSandbox = NewSandboxManager()

// ExecuteScenario 执行场景脚本 execute(env, input)
func (sm *SandboxManager) ExecuteScenario(ctx context.Context, script string, envJSON string, inputData string) (string, string, error) {
	vm := goja.New()

	// 捕获控制台日志
	var logBuf bytes.Buffer
	var logMu sync.Mutex

	console := vm.NewObject()
	_ = console.Set("log", func(call goja.FunctionCall) goja.Value {
		logMu.Lock()
		defer logMu.Unlock()
		var parts []string
		for _, arg := range call.Arguments {
			parts = append(parts, fmt.Sprintf("%v", arg.Export()))
		}
		logBuf.WriteString(strings.Join(parts, " ") + "\n")
		return goja.Undefined()
	})
	_ = vm.Set("console", console)

	// 注入 http 桥接对象
	httpObj := vm.NewObject()
	_ = httpObj.Set("get", func(call goja.FunctionCall) goja.Value {
		return sm.jsHTTPReq(vm, "GET", call)
	})
	_ = httpObj.Set("post", func(call goja.FunctionCall) goja.Value {
		return sm.jsHTTPReq(vm, "POST", call)
	})
	_ = httpObj.Set("request", func(call goja.FunctionCall) goja.Value {
		return sm.jsHTTPReq(vm, "", call)
	})

	// 注入 sleep 延时函数 (毫秒)，在 Go 协程中优雅挂起，不占 CPU，响应 context 超时中断
	sleepFn := func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		ms := call.Arguments[0].ToInteger()
		if ms <= 0 {
			return goja.Undefined()
		}
		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
		case <-ctx.Done():
			panic(vm.ToValue("任务执行超时或已被中断"))
		}
		return goja.Undefined()
	}
	_ = vm.Set("sleep", sleepFn)
	_ = httpObj.Set("sleep", sleepFn)

	_ = vm.Set("http", httpObj)

	// 设置超时中断保护
	stopCh := make(chan struct{})
	defer close(stopCh)
	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt(errors.New("脚本执行超时已被中断"))
		case <-stopCh:
		}
	}()

	// 预编译与执行脚本
	_, err := vm.RunString(script)
	if err != nil {
		return "", logBuf.String(), fmt.Errorf("JS 脚本语法或初始化错误: %w", err)
	}

	executeVal := vm.Get("execute")
	if executeVal == nil {
		return "", logBuf.String(), errors.New("JS 脚本中未定义 execute(env, input) 函数")
	}
	executeFn, ok := goja.AssertFunction(executeVal)
	if !ok {
		return "", logBuf.String(), errors.New("execute 标识符不是有效的函数")
	}

	// 准备 env 参数
	var envObj interface{}
	if envJSON != "" {
		_ = json.Unmarshal([]byte(envJSON), &envObj)
	}
	if envObj == nil {
		envObj = make(map[string]interface{})
	}

	// 准备 input 参数 (若为合法的 JSON 则反序列化为对象，否则作为纯文本传参)
	var inputObj interface{}
	trimmedInput := strings.TrimSpace(inputData)
	if (strings.HasPrefix(trimmedInput, "{") && strings.HasSuffix(trimmedInput, "}")) ||
		(strings.HasPrefix(trimmedInput, "[") && strings.HasSuffix(trimmedInput, "]")) {
		if err := json.Unmarshal([]byte(trimmedInput), &inputObj); err != nil {
			inputObj = inputData
		}
	} else {
		inputObj = inputData
	}

	// 调用 execute(env, input)
	resVal, err := executeFn(goja.Undefined(), vm.ToValue(envObj), vm.ToValue(inputObj))
	if err != nil {
		return "", logBuf.String(), fmt.Errorf("execute() 函数执行异常: %w", err)
	}

	// 规范化输出结果
	exported := resVal.Export()
	var outputStr string
	if exported == nil {
		outputStr = ""
	} else if str, ok := exported.(string); ok {
		outputStr = str
	} else {
		b, err := json.Marshal(exported)
		if err != nil {
			outputStr = fmt.Sprintf("%v", exported)
		} else {
			outputStr = string(b)
		}
	}

	return outputStr, logBuf.String(), nil
}

// jsHTTPReq 处理 JS http 调用的通用代理
func (sm *SandboxManager) jsHTTPReq(vm *goja.Runtime, defaultMethod string, call goja.FunctionCall) goja.Value {
	if len(call.Arguments) == 0 {
		panic(vm.ToValue("http 调用缺少参数"))
	}

	var method string = defaultMethod
	var urlStr string
	var headers map[string]string = make(map[string]string)
	var bodyReader io.Reader
	var timeoutSeconds int = 30

	if defaultMethod != "" {
		// http.get(url, [options]) or http.post(url, [options])
		urlStr = call.Arguments[0].String()
		if len(call.Arguments) > 1 && call.Arguments[1].Export() != nil {
			if optMap, ok := call.Arguments[1].Export().(map[string]interface{}); ok {
				if h, ok := optMap["headers"].(map[string]interface{}); ok {
					for k, v := range h {
						headers[k] = fmt.Sprintf("%v", v)
					}
				}
				if b, ok := optMap["body"].(string); ok {
					bodyReader = strings.NewReader(b)
				}
				if t, ok := optMap["timeout_seconds"].(int64); ok && t > 0 {
					timeoutSeconds = int(t)
				}
			}
		}
	} else {
		// http.request(options)
		if optMap, ok := call.Arguments[0].Export().(map[string]interface{}); ok {
			if m, ok := optMap["method"].(string); ok {
				method = strings.ToUpper(m)
			}
			if u, ok := optMap["url"].(string); ok {
				urlStr = u
			}
			if h, ok := optMap["headers"].(map[string]interface{}); ok {
				for k, v := range h {
					headers[k] = fmt.Sprintf("%v", v)
				}
			}
			if b, ok := optMap["body"].(string); ok {
				bodyReader = strings.NewReader(b)
			}
			if t, ok := optMap["timeout_seconds"].(int64); ok && t > 0 {
				timeoutSeconds = int(t)
			}
		}
	}

	if method == "" {
		method = "GET"
	}
	if urlStr == "" {
		panic(vm.ToValue("http 请求缺少 URL"))
	}

	req, err := http.NewRequest(method, urlStr, bodyReader)
	if err != nil {
		panic(vm.ToValue(fmt.Sprintf("创建 HTTP 请求失败: %v", err)))
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout: time.Duration(timeoutSeconds) * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		panic(vm.ToValue(fmt.Sprintf("HTTP 网络请求失败: %v", err)))
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		panic(vm.ToValue(fmt.Sprintf("读取 HTTP 响应体失败: %v", err)))
	}
	bodyStr := string(respBytes)

	// 构建 JS 响应对象
	respObj := vm.NewObject()
	_ = respObj.Set("status_code", resp.StatusCode)
	_ = respObj.Set("body", bodyStr)

	respHeaders := vm.NewObject()
	for k, v := range resp.Header {
		if len(v) > 0 {
			_ = respHeaders.Set(k, v[0])
		}
	}
	_ = respObj.Set("headers", respHeaders)

	// 注入 .json() 便捷解析方法
	_ = respObj.Set("json", func(goja.FunctionCall) goja.Value {
		var parsed interface{}
		if err := json.Unmarshal([]byte(bodyStr), &parsed); err != nil {
			panic(vm.ToValue(fmt.Sprintf("解析 JSON 响应失败: %v", err)))
		}
		return vm.ToValue(parsed)
	})

	return respObj
}
