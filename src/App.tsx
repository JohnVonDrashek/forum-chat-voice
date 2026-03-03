import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { VoiceProvider } from './lib/voice'
import ScrollToTop from './components/ScrollToTop'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Category from './pages/Category'
import Thread from './pages/Thread'
import NewThread from './pages/NewThread'
import Profile from './pages/Profile'
import Chat from './pages/Chat'
import Search from './pages/Search'
import Voice from './pages/Voice'
import DirectMessages from './pages/DirectMessages'
import Bookmarks from './pages/Bookmarks'
import Settings from './pages/Settings'
import Admin from './pages/Admin'

export default function App() {
  return (
    <AuthProvider>
      <VoiceProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="c/:categorySlug" element={<Category />} />
          <Route path="c/:categorySlug/new" element={<NewThread />} />
          <Route path="t/:threadId" element={<Thread />} />
          <Route path="u/:username" element={<Profile />} />
          <Route path="chat" element={<Chat />} />
          <Route path="chat/:channelId" element={<Chat />} />
          <Route path="search" element={<Search />} />
          <Route path="voice" element={<Voice />} />
          <Route path="voice/:roomId" element={<Voice />} />
          <Route path="dm" element={<DirectMessages />} />
          <Route path="dm/:recipientId" element={<DirectMessages />} />
          <Route path="bookmarks" element={<Bookmarks />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
      </VoiceProvider>
    </AuthProvider>
  )
}
