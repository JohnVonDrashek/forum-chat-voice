import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import Category from './pages/Category'
import Thread from './pages/Thread'
import NewThread from './pages/NewThread'
import Profile from './pages/Profile'
import Chat from './pages/Chat'
import Search from './pages/Search'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="c/:categorySlug" element={<Category />} />
          <Route path="c/:categorySlug/new" element={<NewThread />} />
          <Route path="t/:threadId" element={<Thread />} />
          <Route path="u/:username" element={<Profile />} />
          <Route path="chat" element={<Chat />} />
          <Route path="chat/:channelId" element={<Chat />} />
          <Route path="search" element={<Search />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
