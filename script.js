// API配置
const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const API_KEY = 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// 当前选择的模型
let currentModel = 'deepseek-ai/DeepSeek-V3.2-Exp';

// 全局变量
let conversationHistory = [];
let currentChatId = null;
let chatHistory = [];

// DOM元素
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const chatMessages = document.getElementById('chatMessages');
const loading = document.getElementById('loading');

// 初始化函数
function init() {
    setupEventListeners();
    updateMessageTime();
    loadChatHistory();
    messageInput.focus();
}

// 设置事件监听器
function setupEventListeners() {
    // 发送按钮点击事件
    sendButton.addEventListener('click', sendMessage);
    
    // 清空对话按钮点击事件
    document.getElementById('clearChatBtn').addEventListener('click', clearChat);
    
    // 新建对话按钮点击事件
    document.getElementById('newChatBtn').addEventListener('click', newChat);
    
    // 输入框回车发送
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // 输入框输入事件
    messageInput.addEventListener('input', () => {
        updateSendButtonState();
    });
    
    // 初始化侧边栏事件
    initSidebarEvents();
    
    // 模型选择器变化事件
    document.getElementById('modelSelector').addEventListener('change', handleModelChange);
}

// 自动调整文本区域高度
function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// 更新发送按钮状态
function updateSendButtonState() {
    const hasText = messageInput.value.trim().length > 0;
    sendButton.disabled = !hasText;
}

// 处理模型切换
function handleModelChange(event) {
    const selectedModel = event.target.value;
    currentModel = selectedModel;
    
    // 显示模型切换提示
    showToast(`已切换到 ${getModelDisplayName(selectedModel)} 模型`);
}

// 获取模型显示名称
function getModelDisplayName(modelValue) {
    const modelMap = {
        'deepseek-ai/DeepSeek-V3.2-Exp': 'DeepSeek-V3.2',
        'zai-org/GLM-4.6': '智谱GLM-4.6',
        'Qwen/Qwen3-VL-32B-Instruct': '千问Qwen3-VL'
    };
    return modelMap[modelValue] || modelValue;
}

// 发送消息（流式版本）
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;
    
    // 添加用户消息到聊天界面
    addMessage(message, 'user');
    
    // 清空输入框
    messageInput.value = '';
    messageInput.style.height = 'auto';
    updateSendButtonState();
    
    // 显示加载状态
    showLoading(true);
    
    // 创建流式消息元素
    let streamingMessage = createStreamingMessage('bot');
    let fullResponse = '';
    
    try {
        // 调用API获取流式回复
        const response = await callDeepSeekAPI(message, (chunk, currentFullResponse) => {
            // 隐藏加载状态（一旦开始收到响应）
            showLoading(false);
            
            fullResponse = currentFullResponse;
            
            // 更新流式消息显示
            updateStreamingMessage(streamingMessage, fullResponse);
            
            // 滚动到底部
            scrollToBottom();
        });
        
        // 完成流式消息
        completeStreamingMessage(streamingMessage, response);
        
        // 更新对话历史
        conversationHistory.push(
            { role: 'user', content: message },
            { role: 'assistant', content: response }
        );
        
        // 保存到本地存储
        saveCurrentChatMessage(message, response);
        
        // 限制对话历史长度（防止token过多）
        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-20);
        }
        
    } catch (error) {
        console.error('API调用失败:', error);
        
        // 如果流式消息已经创建，更新错误信息
        if (streamingMessage) {
            completeStreamingMessage(streamingMessage, '抱歉，我暂时无法回复。请稍后再试。');
        } else {
            // 否则创建新的错误消息
            addMessage('抱歉，我暂时无法回复。请稍后再试。', 'bot');
        }
    } finally {
        // 隐藏加载状态
        showLoading(false);
        
        // 滚动到底部
        scrollToBottom();
        
        // 重新聚焦输入框
        messageInput.focus();
    }
}

// 调用DeepSeek API（流式响应）
async function callDeepSeekAPI(message, onStreamChunk) {
    const messages = [
        ...conversationHistory,
        { role: 'user', content: message }
    ];
    
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: currentModel,
            messages: messages,
            max_tokens: 2048,
            temperature: 0.7,
            stream: true
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API错误: ${response.status} - ${errorData.message || response.statusText}`);
    }
    
    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const jsonStr = line.slice(6); // 移除 'data: ' 前缀
                        if (jsonStr.trim()) {
                            const data = JSON.parse(jsonStr);
                            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                                const content = data.choices[0].delta.content;
                                fullResponse += content;
                                if (onStreamChunk) {
                                    onStreamChunk(content, fullResponse);
                                }
                            }
                        }
                    } catch (e) {
                        // 忽略JSON解析错误，继续处理下一个数据块
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
    
    return fullResponse.trim();
}

// 添加消息到聊天界面
function addMessage(content, type, useTypewriter = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = getCurrentTime();
    
    messageDiv.appendChild(messageContent);
    messageDiv.appendChild(messageTime);
    
    chatMessages.appendChild(messageDiv);
    
    if (useTypewriter && content) {
        // 使用打字机效果
        typewriterEffect(messageContent, content, 30, () => {
            // 打字完成后更新时间为最终时间
            messageTime.textContent = getCurrentTime();
        });
    } else {
        // 直接显示内容
        messageContent.textContent = content;
    }
    
    // 滚动到底部
    scrollToBottom();
    
    return {
        element: messageContent,
        timeElement: messageTime,
        container: messageDiv
    };
}

// 获取当前时间
function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

// 更新消息时间（用于初始消息）
function updateMessageTime() {
    const timeElements = document.querySelectorAll('.message-time');
    timeElements.forEach(element => {
        if (element.textContent === '{{current_time}}') {
            element.textContent = getCurrentTime();
        }
    });
}

// 滚动到底部
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示/隐藏加载状态
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
    sendButton.disabled = show;
}

// 打字机效果函数
function typewriterEffect(element, text, speed = 30, onComplete = null) {
    element.textContent = '';
    let i = 0;
    
    function type() {
        if (i < text.length) {
            // 添加下一个字符
            element.textContent += text.charAt(i);
            i++;
            
            // 随机速度变化，让打字效果更自然
            const randomSpeed = speed + Math.random() * 20 - 10;
            setTimeout(type, randomSpeed);
            
            // 滚动到底部
            scrollToBottom();
        } else if (onComplete) {
            onComplete();
        }
    }
    
    type();
}

// 创建流式消息元素
function createStreamingMessage(type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message streaming-message`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content streaming-content';
    
    // 添加打字光标
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    cursor.textContent = '|';
    
    messageContent.appendChild(cursor);
    
    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = getCurrentTime();
    
    messageDiv.appendChild(messageContent);
    messageDiv.appendChild(messageTime);
    
    chatMessages.appendChild(messageDiv);
    
    // 滚动到底部
    scrollToBottom();
    
    return {
        element: messageContent,
        cursor: cursor,
        timeElement: messageTime,
        container: messageDiv
    };
}

// 更新流式消息内容
function updateStreamingMessage(streamingMessage, content) {
    // 移除光标
    if (streamingMessage.cursor && streamingMessage.cursor.parentNode) {
        streamingMessage.cursor.remove();
    }
    
    // 更新内容
    streamingMessage.element.textContent = content;
    
    // 重新添加光标
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    cursor.textContent = '|';
    streamingMessage.element.appendChild(cursor);
    
    // 滚动到底部
    scrollToBottom();
}

// 完成流式消息（移除光标，添加最终时间）
function completeStreamingMessage(streamingMessage, finalContent) {
    // 移除光标
    if (streamingMessage.cursor && streamingMessage.cursor.parentNode) {
        streamingMessage.cursor.remove();
    }
    
    // 设置最终内容
    streamingMessage.element.textContent = finalContent;
    
    // 移除流式消息类，添加完成类
    streamingMessage.container.classList.remove('streaming-message');
    streamingMessage.container.classList.add('completed-message');
    
    // 更新时间为最终时间
    streamingMessage.timeElement.textContent = getCurrentTime();
    
    // 滚动到底部
    scrollToBottom();
}

// 初始化应用
document.addEventListener('DOMContentLoaded', init);

// 错误处理
window.addEventListener('error', (e) => {
    console.error('JavaScript错误:', e.error);
});

// 清空对话功能
function clearChat() {
    if (confirm('确定要清空当前对话吗？这将删除所有聊天记录。')) {
        // 清空聊天消息区域，保留第一条欢迎消息
        const welcomeMessage = chatMessages.querySelector('.bot-message:first-child');
        chatMessages.innerHTML = '';
        
        if (welcomeMessage) {
            chatMessages.appendChild(welcomeMessage);
            // 更新欢迎消息的时间
            const timeElement = welcomeMessage.querySelector('.message-time');
            if (timeElement) {
                timeElement.textContent = getCurrentTime();
            }
        } else {
            // 如果没有欢迎消息，创建一个
            addMessage('您好！我是AI助手，有什么可以帮您的吗？', 'bot');
        }
        
        // 清空对话历史
        conversationHistory = [];
        
        // 显示操作成功的提示
        showToast('对话已清空');
    }
}

// 新建对话功能
function newChat() {
    if (conversationHistory.length > 0 || chatMessages.children.length > 1) {
        if (confirm('确定要开始新的对话吗？当前对话将被保存到历史记录中。')) {
            // 创建新的聊天
            createNewChat();
            
            // 完全清空聊天消息区域
            chatMessages.innerHTML = '';
            
            // 添加新的欢迎消息
            addMessage('您好！开始新的对话，有什么可以帮您的吗？', 'bot');
            
            // 显示操作成功的提示
            showToast('已开始新对话');
        }
    } else {
        showToast('已经是新的对话');
    }
}

// 显示操作提示
function showToast(message) {
    // 移除现有的toast
    const existingToast = document.getElementById('chatToast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // 创建toast元素
    const toast = document.createElement('div');
    toast.id = 'chatToast';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1001;
        animation: fadeInOut 2s ease-in-out;
    `;
    toast.textContent = message;
    
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, -20px); }
            10% { opacity: 1; transform: translate(-50%, 0); }
            90% { opacity: 1; transform: translate(-50%, 0); }
            100% { opacity: 0; transform: translate(-50%, -20px); }
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(toast);
    
    // 2秒后自动移除
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
        if (style.parentNode) {
            style.remove();
        }
    }, 2000);
}

// 未处理的Promise拒绝
window.addEventListener('unhandledrejection', (e) => {
    console.error('未处理的Promise拒绝:', e.reason);
    e.preventDefault();
});

// ==================== 历史对话存储功能 ====================

// 生成唯一ID
function generateChatId() {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 保存聊天记录到本地存储
function saveChatHistory() {
    try {
        const historyData = {
            chatHistory: chatHistory,
            currentChatId: currentChatId
        };
        localStorage.setItem('aiChatHistory', JSON.stringify(historyData));
    } catch (error) {
        console.error('保存聊天记录失败:', error);
    }
}

// 从本地存储加载聊天记录
function loadChatHistory() {
    try {
        const savedData = localStorage.getItem('aiChatHistory');
        if (savedData) {
            const historyData = JSON.parse(savedData);
            chatHistory = historyData.chatHistory || [];
            currentChatId = historyData.currentChatId || null;
            
            // 如果当前聊天ID存在但不在历史中，创建新的聊天
            if (currentChatId && !chatHistory.find(chat => chat.id === currentChatId)) {
                currentChatId = null;
            }
            
            // 如果没有当前聊天，创建新的
            if (!currentChatId && chatHistory.length === 0) {
                createNewChat();
            }
            
            // 更新侧边栏显示
            updateHistorySidebar();
        } else {
            // 首次使用，创建新的聊天
            createNewChat();
        }
    } catch (error) {
        console.error('加载聊天记录失败:', error);
        createNewChat();
    }
}

// 创建新的聊天
function createNewChat() {
    currentChatId = generateChatId();
    const newChat = {
        id: currentChatId,
        title: '新对话',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    chatHistory.unshift(newChat);
    conversationHistory = [];
    
    // 保存到本地存储
    saveChatHistory();
    
    // 更新侧边栏
    updateHistorySidebar();
    
    return newChat;
}

// 保存当前聊天消息
function saveCurrentChatMessage(userMessage, assistantMessage) {
    if (!currentChatId) {
        createNewChat();
    }
    
    const currentChat = chatHistory.find(chat => chat.id === currentChatId);
    if (currentChat) {
        // 添加消息到聊天记录
        currentChat.messages.push({
            role: 'user',
            content: userMessage,
            timestamp: new Date().toISOString()
        });
        
        currentChat.messages.push({
            role: 'assistant',
            content: assistantMessage,
            timestamp: new Date().toISOString()
        });
        
        // 更新聊天标题（使用用户第一条消息的前20个字符）
        if (currentChat.title === '新对话' && userMessage) {
            currentChat.title = userMessage.substring(0, 20) + (userMessage.length > 20 ? '...' : '');
        }
        
        // 更新修改时间
        currentChat.updatedAt = new Date().toISOString();
        
        // 保存到本地存储
        saveChatHistory();
        
        // 更新侧边栏
        updateHistorySidebar();
    }
}

// 切换到指定聊天
function switchToChat(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
        currentChatId = chatId;
        
        // 清空当前聊天界面
        chatMessages.innerHTML = '';
        
        // 加载聊天消息
        chat.messages.forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot', false);
        });
        
        // 如果没有消息，添加欢迎消息
        if (chat.messages.length === 0) {
            addMessage('您好！我是AI助手，有什么可以帮您的吗？', 'bot');
        }
        
        // 更新对话历史
        conversationHistory = chat.messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        
        // 保存当前状态
        saveChatHistory();
        
        // 更新侧边栏激活状态
        updateHistorySidebar();
        
        // 关闭侧边栏（移动端）
        closeSidebar();
        
        // 滚动到底部
        scrollToBottom();
        
        // 聚焦输入框
        messageInput.focus();
    }
}

// 清空所有历史对话
function clearAllHistory() {
    if (confirm('确定要清空所有历史对话吗？这将删除所有保存的聊天记录。')) {
        chatHistory = [];
        currentChatId = null;
        
        // 创建新的聊天
        createNewChat();
        
        // 清空当前聊天界面
        chatMessages.innerHTML = '';
        addMessage('您好！我是AI助手，有什么可以帮您的吗？', 'bot');
        
        // 显示操作成功的提示
        showToast('历史对话已清空');
    }
}

// 更新侧边栏历史对话列表
function updateHistorySidebar() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    // 清空现有列表
    historyList.innerHTML = '';
    
    // 按更新时间倒序排列
    const sortedHistory = [...chatHistory].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    sortedHistory.forEach(chat => {
        const historyItem = document.createElement('button');
        historyItem.className = 'history-item';
        if (chat.id === currentChatId) {
            historyItem.classList.add('active');
        }
        
        historyItem.innerHTML = `
            <div class="history-item-content">
                <div class="history-item-title">${escapeHtml(chat.title)}</div>
                <div class="history-item-time">${formatTime(chat.updatedAt)}</div>
            </div>
        `;
        
        historyItem.addEventListener('click', () => switchToChat(chat.id));
        historyList.appendChild(historyItem);
    });
    
    // 如果没有历史记录，显示提示
    if (sortedHistory.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'history-empty';
        emptyMessage.textContent = '暂无历史对话';
        emptyMessage.style.cssText = 'text-align: center; color: #6c757d; padding: 20px; font-size: 14px;';
        historyList.appendChild(emptyMessage);
    }
}

// HTML转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 格式化时间显示
function formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) {
        return '刚刚';
    } else if (diffMins < 60) {
        return `${diffMins}分钟前`;
    } else if (diffHours < 24) {
        return `${diffHours}小时前`;
    } else if (diffDays < 7) {
        return `${diffDays}天前`;
    } else {
        return date.toLocaleDateString('zh-CN');
    }
}

// ==================== 侧边栏功能 ====================

// 切换侧边栏显示/隐藏
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('open');
    }
}

// 关闭侧边栏
function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('open');
    }
}

// 初始化侧边栏事件
function initSidebarEvents() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }
    
    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }
    
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearAllHistory);
    }
    
    // 点击侧边栏外部关闭
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        if (sidebar && sidebar.classList.contains('open') && 
            !sidebar.contains(e.target) && 
            !sidebarToggle.contains(e.target)) {
            closeSidebar();
        }
    });
}
