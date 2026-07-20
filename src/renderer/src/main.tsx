import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Spotlight } from './components/Spotlight'
import { PetWindow } from './pet/PetWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import './assets/main.css'

// 全局快捷搜索 overlay 复用同一个 bundle：#spotlight hash 时只渲染 Spotlight，
// 避免额外的多入口构建配置。
const isSpotlight = window.location.hash === '#spotlight'
// 宠物窗口同样复用同一个 bundle：#pet hash 时只渲染宠物根组件。
const isPet = window.location.hash === '#pet'

// overlay / 宠物窗口本身是透明的，需让 body/html 背景透明才能呈现浮层效果
if (isSpotlight || isPet) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isSpotlight ? <Spotlight /> : isPet ? <PetWindow /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)
