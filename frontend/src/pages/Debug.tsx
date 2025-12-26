import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ScrcpyPlayer } from '@/components/ScrcpyPlayer'
import { ChatItemCard, type ChatItem, type StepInfo, parseActionToObject } from '@/components/ChatSteps'
import { devicesApi, settingsApi } from '@/api/client'
import { Send, Smartphone, Loader2, AlertTriangle, Bot, Home, ArrowLeft, LayoutGrid, Hand } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

// 敏感操作确认信息
interface SensitiveAction {
  message: string
  step: number
  action: string
}

export function Debug() {
  const [chatItems, setChatItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [streamKey, setStreamKey] = useState(0)
  const [useFallback, setUseFallback] = useState(false)
  // 触控模式
  const [touchEnabled, setTouchEnabled] = useState(true)
  // 敏感操作确认对话框状态
  const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | null>(null)
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  // 流式 token 状态
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingAction, setStreamingAction] = useState('')
  const currentStreamStepRef = useRef(0)

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: devicesApi.list,
    refetchInterval: 5000,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  // 获取当前设备（优先使用全局选定的设备，否则回退到第一个在线设备）
  const activeDevice = (() => {
    const onlineDevices = devices.filter(d => d.status === 'device')
    if (!onlineDevices.length) return undefined
    if (settings?.selected_device) {
      const selected = onlineDevices.find(d => d.serial === settings.selected_device)
      if (selected) return selected
    }
    return onlineDevices[0]
  })()

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatItems, streamingThinking, streamingAction])

  // 流式执行指令（使用 fetch + ReadableStream）
  const executeStream = async (command: string) => {
    const url = `${API_BASE}/debug/execute-stream`

    // 重置流式状态
    setStreamingThinking('')
    setStreamingAction('')
    currentStreamStepRef.current = 0

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || '请求失败')
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          // 解析 SSE 事件类型
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
            continue
          }

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              // 处理流式 token
              if (eventType === 'token' || data.type === 'token') {
                const { step, phase, content } = data
                if (step !== currentStreamStepRef.current) {
                  // 新步骤开始，清空流式内容
                  setStreamingThinking('')
                  setStreamingAction('')
                  currentStreamStepRef.current = step
                }
                if (phase === 'thinking') {
                  setStreamingThinking(prev => prev + content)
                } else if (phase === 'action') {
                  setStreamingAction(prev => prev + content)
                }
                continue
              }

              if (data.type === 'start') {
                console.log('[Debug] 任务开始执行')
              } else if (data.type === 'step') {
                const stepInfo = data as StepInfo
                const now = Date.now()
                // 检查是否是 takeover 或 sensitive 步骤
                const isTakeover = data.takeover === true
                const isSensitive = data.sensitive === true

                // 清空流式状态
                setStreamingThinking('')
                setStreamingAction('')

                // 添加思考消息（已完成的）
                if (stepInfo.thinking) {
                  setChatItems(prev => [...prev, {
                    id: now + stepInfo.step * 100,
                    type: 'thinking',
                    content: stepInfo.thinking,
                    timestamp: new Date(),
                    stepInfo,
                  }])
                }

                // 添加动作卡片（takeover 和 sensitive 由专门的事件处理，跳过这里）
                if (stepInfo.action && !isTakeover && !isSensitive) {
                  const actionData = parseActionToObject(stepInfo.action)
                  if (actionData) {
                    setChatItems(prev => [...prev, {
                      id: now + stepInfo.step * 100 + 1,
                      type: 'action',
                      content: '',
                      timestamp: new Date(),
                      stepInfo,
                      actionData,
                    }])
                  }
                }

                // 如果是最后一步，添加结果消息
                if (stepInfo.finished && stepInfo.message) {
                  setTimeout(() => {
                    setChatItems(prev => [...prev, {
                      id: now + 2000,
                      type: 'result',
                      content: stepInfo.message!,
                      timestamp: new Date(),
                    }])
                  }, 100)
                }
              } else if (data.type === 'sensitive') {
                // 敏感操作：需要用户确认
                setSensitiveAction({
                  message: data.message,
                  step: data.step,
                  action: data.action,
                })
                // 添加等待确认的消息
                setChatItems(prev => [...prev, {
                  id: Date.now(),
                  type: 'sensitive',
                  content: data.message,
                  timestamp: new Date(),
                }])
              } else if (data.type === 'takeover') {
                // Take_over 动作：需要用户手动操作
                setChatItems(prev => [...prev, {
                  id: Date.now(),
                  type: 'takeover',
                  content: data.message,
                  timestamp: new Date(),
                }])
              } else if (data.type === 'done') {
                // 清空流式状态
                setStreamingThinking('')
                setStreamingAction('')
                currentStreamStepRef.current = 0

                if (data.paused) {
                  // 暂停状态，等待用户手动操作后继续
                  setIsExecuting(false)
                  // 如果是敏感操作暂停，保存当前命令以便继续
                  if (data.pauseReason === 'sensitive') {
                    setPendingCommand(command)
                  }
                  return
                }
                if (data.message && !data.success) {
                  setChatItems(prev => [...prev, {
                    id: Date.now(),
                    type: 'result',
                    content: data.message,
                    timestamp: new Date(),
                  }])
                }
                setIsExecuting(false)
                return
              } else if (data.type === 'error') {
                // 清空流式状态
                setStreamingThinking('')
                setStreamingAction('')
                currentStreamStepRef.current = 0

                setChatItems(prev => [...prev, {
                  id: Date.now(),
                  type: 'error',
                  content: data.message,
                  timestamp: new Date(),
                }])
                setIsExecuting(false)
                return
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
      setIsExecuting(false)
    } catch (err) {
      setStreamingThinking('')
      setStreamingAction('')
      currentStreamStepRef.current = 0
      setChatItems(prev => [...prev, {
        id: Date.now(),
        type: 'error',
        content: err instanceof Error ? err.message : '连接错误',
        timestamp: new Date(),
      }])
      setIsExecuting(false)
    }
  }

  const handleSend = () => {
    if (!input.trim() || isExecuting) return

    const cmd = input.trim()

    // 添加用户消息
    setChatItems(prev => [...prev, {
      id: Date.now(),
      type: 'user',
      content: cmd,
      timestamp: new Date(),
    }])

    setIsExecuting(true)
    setInput('')
    executeStream(cmd)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 确认敏感操作后继续执行
  const handleConfirmSensitive = () => {
    setSensitiveAction(null)
    // 添加确认消息
    setChatItems(prev => [...prev, {
      id: Date.now(),
      type: 'result',
      content: '已确认操作，继续执行...',
      timestamp: new Date(),
    }])
    // 继续执行（使用 "继续" 命令让 agent 继续）
    if (pendingCommand) {
      setIsExecuting(true)
      executeStream('继续执行')
      setPendingCommand(null)
    }
  }

  // 取消敏感操作
  const handleCancelSensitive = () => {
    setSensitiveAction(null)
    setPendingCommand(null)
    // 添加取消消息
    setChatItems(prev => [...prev, {
      id: Date.now(),
      type: 'error',
      content: '已取消操作',
      timestamp: new Date(),
    }])
  }

  // 设备控制操作
  const handleKeyEvent = async (key: 'home' | 'back' | 'app_switch') => {
    if (!activeDevice) return
    try {
      await devicesApi.sendKeyEvent(activeDevice.serial, key)
    } catch (err) {
      console.error(`发送 ${key} 按键失败:`, err)
    }
  }

  const handleSwipe = async (startX: number, startY: number, endX: number, endY: number) => {
    if (!activeDevice) return
    try {
      await devicesApi.sendSwipe(activeDevice.serial, startX, startY, endX, endY)
    } catch (err) {
      console.error('发送滑动失败:', err)
    }
  }

  const handleTap = async (x: number, y: number) => {
    if (!activeDevice) return
    try {
      await devicesApi.sendTap(activeDevice.serial, x, y)
    } catch (err) {
      console.error('发送点击失败:', err)
    }
  }

  return (
    <TooltipProvider>
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">调试控制台</h1>
        {activeDevice ? (
          <Badge variant="success" className="flex items-center gap-1">
            <Smartphone className="h-3 w-3" />
            {activeDevice.model || activeDevice.serial}
          </Badge>
        ) : (
          <Badge variant="destructive">未连接设备</Badge>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 overflow-hidden">
        {/* 左侧 - 对话区域 */}
        <Card className="flex flex-col min-h-0 h-full overflow-hidden">
          <CardHeader className="pb-3 shrink-0 border-b">
            <CardTitle className="text-base">执行步骤</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {chatItems.length === 0 && !isExecuting ? (
              <div className="text-center text-muted-foreground py-8">
                发送指令开始调试
              </div>
            ) : (
              chatItems.map(item => (
                <ChatItemCard key={item.id} item={item} />
              ))
            )}
            {/* 流式输出显示 - 与 ChatItemCard thinking 样式一致 */}
            {isExecuting && (streamingThinking || streamingAction) && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 max-w-[85%]">
                  <div className="text-xs text-muted-foreground mb-1">
                    Step {currentStreamStepRef.current || 1}
                  </div>
                  <div className="p-3 rounded-2xl rounded-tl-sm bg-muted text-sm whitespace-pre-wrap">
                    {streamingThinking}
                    {streamingAction && (
                      <span className="text-muted-foreground">{streamingAction}</span>
                    )}
                    <span className="inline-block w-1.5 h-4 bg-foreground/60 ml-0.5 animate-pulse align-middle" />
                  </div>
                </div>
              </div>
            )}
            {/* 等待状态（无流式内容时）- 跳动的省略号 */}
            {isExecuting && !streamingThinking && !streamingAction && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 max-w-[85%]">
                  <div className="text-xs text-muted-foreground mb-1">
                    Step {currentStreamStepRef.current || 1}
                  </div>
                  <div className="p-3 rounded-2xl rounded-tl-sm bg-muted text-sm flex items-center gap-0.5">
                    <span className="inline-block w-1 h-1 rounded-full bg-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="inline-block w-1 h-1 rounded-full bg-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="inline-block w-1 h-1 rounded-full bg-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </CardContent>
          {/* 输入区域 */}
          <div className="p-4 border-t shrink-0">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入指令，如：打开微信..."
                className="min-h-15 max-h-30 resize-none"
                disabled={isExecuting || !activeDevice}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isExecuting || !activeDevice}
                className="shrink-0"
              >
                {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </Card>

        {/* 右侧 - 实时画面 */}
        <Card className="flex flex-col min-h-0 h-full overflow-hidden">
          <CardHeader className="pb-3 shrink-0 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                实时画面
              </CardTitle>
              <div className="flex items-center gap-1">
                {activeDevice && (
                  <>
                    {/* 触控模式开关 */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={touchEnabled ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => setTouchEnabled(!touchEnabled)}
                        >
                          <Hand className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {touchEnabled ? '触控已启用（点击禁用）' : '触控已禁用（点击启用）'}
                      </TooltipContent>
                    </Tooltip>
                    {/* 导航按钮 */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => handleKeyEvent('back')}>
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>返回</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => handleKeyEvent('home')}>
                          <Home className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>主页</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => handleKeyEvent('app_switch')}>
                          <LayoutGrid className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>最近任务</TooltipContent>
                    </Tooltip>
                    <Button variant="ghost" size="sm" onClick={() => setStreamKey(k => k + 1)}>
                      刷新
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center p-4 bg-muted/30 overflow-hidden">
            {activeDevice ? (
              useFallback ? (
                <img
                  key={streamKey}
                  src={devicesApi.getStreamUrl(activeDevice.serial)}
                  alt="设备屏幕"
                  className="max-h-full w-auto rounded-lg shadow-lg"
                  style={{ maxWidth: '280px', objectFit: 'contain' }}
                />
              ) : (
                <ScrcpyPlayer
                  key={streamKey}
                  deviceId={activeDevice.serial}
                  className="max-h-full"
                  onFallback={() => setUseFallback(true)}
                  fallbackTimeout={8000}
                  enableTouch={touchEnabled}
                  onSwipe={handleSwipe}
                  onTap={handleTap}
                />
              )
            ) : (
              <div className="text-center text-muted-foreground">
                <Smartphone className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>未连接设备</p>
                <p className="text-xs mt-1">请通过 ADB 连接手机</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 敏感操作确认对话框 */}
      <AlertDialog open={sensitiveAction !== null} onOpenChange={(open) => !open && handleCancelSensitive()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              敏感操作确认
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>AI 正在尝试执行以下敏感操作：</p>
              <p className="font-medium text-foreground bg-muted p-3 rounded-lg">
                {sensitiveAction?.message}
              </p>
              <p className="text-sm">请确认是否允许执行此操作？</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelSensitive}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSensitive} className="bg-amber-600 hover:bg-amber-700">
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  )
}
