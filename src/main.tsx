import React from 'react'
import ReactDOM from 'react-dom/client'

const App = () => {
  return (
    <div style={{
      color: 'white',
      background: 'black',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '20px'
    }}>
      IOS RUNTIME TEST SUCCESS
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)