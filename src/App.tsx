import React, { useState, useRef, ChangeEvent, DragEvent } from 'react';
import { UploadCloud, FileType, Type, Download, Loader2, CheckCircle2 } from 'lucide-react';
import { convertTtfToBdf } from './ttfToBdf';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [fontSize, setFontSize] = useState<number>(16);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [isDragActive, setIsDragActive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const processFile = (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.ttf')) {
      setError('Please select a valid .ttf font file.');
      return;
    }
    setFile(selectedFile);
    setError(null);
    setSuccess(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    
    setIsConverting(true);
    setError(null);
    
    try {
      const buffer = await file.arrayBuffer();
      // Allow browser to render UI before heavy CPU work
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const bdfText = await convertTtfToBdf(buffer, fontSize);
      
      const blob = new Blob([bdfText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.ttf$/i, '') + '_' + fontSize + 'px.bdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during conversion.');
    } finally {
      setIsConverting(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="container">
      <header className="header">
        <h1>ttf into bdf</h1>
        <p>convert truetype to bitmap distribution format</p>
      </header>

      <main className="card">
        {!file ? (
          <div 
            className={`dropzone ${isDragActive ? 'active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon">
              <UploadCloud size={48} strokeWidth={1.5} />
            </div>
            <h3>Drag & Drop your TTF file here</h3>
            <p>or click to browse from your computer</p>
            <input 
              type="file" 
              accept=".ttf" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileInput}
            />
          </div>
        ) : (
          <div className="conversion-panel">
            <div className="file-info">
              <div className="file-details">
                <FileType className="file-icon" size={32} />
                <div>
                  <div className="file-name">{file.name}</div>
                  <div className="file-size">{formatFileSize(file.size)}</div>
                </div>
              </div>
              <button 
                className="btn-clear" 
                onClick={() => { setFile(null); setSuccess(false); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Change file
              </button>
            </div>

            <div className="controls">
              <div className="control-group">
                <label htmlFor="fontSize">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Type size={16} /> Output Pixel Size
                  </div>
                </label>
                <input 
                  type="number" 
                  id="fontSize" 
                  min="8" 
                  max="128" 
                  value={fontSize} 
                  onChange={(e) => setFontSize(parseInt(e.target.value) || 16)} 
                />
              </div>

              {error && (
                <div className="error-msg">
                  {error}
                </div>
              )}

              <button 
                className={`btn ${success ? 'success' : ''}`} 
                onClick={handleConvert}
                disabled={isConverting}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="animate-spin" /> Converting...
                  </>
                ) : success ? (
                  <>
                    <CheckCircle2 /> Downloaded Successfully
                  </>
                ) : (
                  <>
                    <Download /> Convert to BDF
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
