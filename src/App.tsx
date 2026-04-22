import { useState, useRef } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { UploadCloud, FileType, Type, Download, Loader2, CheckCircle2, Trash2, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { convertTtfToBdf } from './ttfToBdf';
import { parseBdf, decodeHexToBitmap } from './bdfParser';
import type { BdfChar } from './bdfParser';
import JSZip from 'jszip';

// Render a single BDF Character Card
function CharCard({ char }: { char: BdfChar }) {
  const bitmap = decodeHexToBitmap(char.width, char.height, char.hexData);
  return (
    <div className="bdf-char-card">
      <h4>{char.name}</h4>
      <div className="pixel-grid">
        {bitmap.map((row, y) => (
          <div key={y} className="pixel-row">
            {row.map((isOn, x) => (
              <div key={x} className={`pixel ${isOn ? 'on' : 'off'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<'convert' | 'view'>('convert');
  
  // Converter State
  const [files, setFiles] = useState<File[]>([]);
  const [sizesInput, setSizesInput] = useState<string>("16, 24");
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  
  // Viewer State
  const [bdfChars, setBdfChars] = useState<BdfChar[] | null>(null);
  const [viewFileName, setViewFileName] = useState<string | null>(null);
  const [viewerPage, setViewerPage] = useState<number>(1);
  const charsPerPage = 50;

  const [isDragActive, setIsDragActive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bdfInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const processConvertFiles = (selectedFiles: FileList | File[]) => {
    const validFiles: File[] = [];
    let hasInvalid = false;
    
    Array.from(selectedFiles).forEach(file => {
      if (file.name.toLowerCase().endsWith('.ttf')) {
        validFiles.push(file);
      } else {
        hasInvalid = true;
      }
    });

    if (hasInvalid && validFiles.length === 0) {
      setError('Please select valid .ttf font files only.');
      return;
    }

    setFiles(prev => [...prev, ...validFiles]);
    if (hasInvalid) {
      setError('Some files were ignored because they were not .ttf files.');
    } else {
      setError(null);
    }
    setSuccess(false);
  };

  const processViewFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.bdf')) {
      setError('Please select a valid .bdf file to view.');
      return;
    }
    setError(null);
    
    // We parse in a slight timeout so the UI can render a "loading" state if we wanted to
    try {
      const text = await file.text();
      const chars = parseBdf(text);
      setBdfChars(chars);
      setViewFileName(file.name);
      setViewerPage(1);
    } catch (err) {
      console.error(err);
      setError("Failed to parse BDF file. It might be corrupted or too large.");
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (activeTab === 'convert') {
        processConvertFiles(e.dataTransfer.files);
      } else {
        processViewFile(e.dataTransfer.files[0]);
      }
    }
  };

  const handleConvertFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processConvertFiles(e.target.files);
    }
  };

  const handleViewFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processViewFile(e.target.files[0]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    setSuccess(false);
  };

  const parseSizes = (): number[] => {
    return sizesInput
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(s => !isNaN(s) && s > 0 && s <= 200);
  };

  const handleConvert = async () => {
    if (files.length === 0) return;
    
    const sizes = parseSizes();
    if (sizes.length === 0) {
      setError('Please enter at least one valid font size.');
      return;
    }

    setIsConverting(true);
    setError(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const isMultiple = files.length > 1 || sizes.length > 1;
      const zip = new JSZip();

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const baseName = file.name.replace(/\.ttf$/i, '');
        
        for (const size of sizes) {
          const bdfText = await convertTtfToBdf(buffer, size);
          const fileName = `${baseName}_${size}px.bdf`;
          
          if (isMultiple) {
            zip.file(fileName, bdfText);
          } else {
            const blob = new Blob([bdfText], { type: 'text/plain' });
            triggerDownload(blob, fileName);
          }
        }
      }

      if (isMultiple) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(zipBlob, 'bdf_fonts.zip');
      }
      
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during conversion.');
    } finally {
      setIsConverting(false);
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Viewer Pagination Logic
  const totalPages = bdfChars ? Math.ceil(bdfChars.length / charsPerPage) : 0;
  const currentChars = bdfChars ? bdfChars.slice((viewerPage - 1) * charsPerPage, viewerPage * charsPerPage) : [];

  return (
    <div className="container">
      <header className="header">
        <h1>ttf into bdf</h1>
        <p>convert truetype to bitmap distribution format</p>
      </header>

      <div className="tabs">
        <div 
          className={`tab ${activeTab === 'convert' ? 'active' : ''}`}
          onClick={() => { setActiveTab('convert'); setError(null); }}
        >
          Convert TTF
        </div>
        <div 
          className={`tab ${activeTab === 'view' ? 'active' : ''}`}
          onClick={() => { setActiveTab('view'); setError(null); }}
        >
          View BDF
        </div>
      </div>

      <main className="card">
        {error && (
          <div className="error-msg" style={{ marginBottom: '2rem' }}>
            {error}
          </div>
        )}

        {activeTab === 'convert' && (
          <>
            {files.length === 0 ? (
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
                <h3>Drag & Drop TTF files here</h3>
                <p>or click to browse multiple files</p>
                <input 
                  type="file" 
                  accept=".ttf" 
                  multiple
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleConvertFileInput}
                />
              </div>
            ) : (
              <div className="conversion-panel">
                <div className="files-list" style={{ marginBottom: '2rem' }}>
                  <h3 style={{ marginBottom: '1rem', textTransform: 'uppercase' }}>Selected Files ({files.length})</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    {files.map((file, idx) => (
                      <div key={idx} className="file-info" style={{ marginBottom: 0, padding: '0.5rem 1rem' }}>
                        <div className="file-details">
                          <FileType className="file-icon" size={24} />
                          <div>
                            <div className="file-name" style={{ fontSize: '0.9rem' }}>{file.name}</div>
                            <div className="file-size" style={{ fontSize: '0.75rem' }}>{formatFileSize(file.size)}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeFile(idx)}
                          style={{ background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer' }}
                          title="Remove file"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
                    >
                      + add more files
                    </button>
                    <button 
                      onClick={() => { setFiles([]); setSuccess(false); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
                    >
                      clear all
                    </button>
                  </div>
                  <input 
                    type="file" 
                    accept=".ttf" 
                    multiple
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    onChange={handleConvertFileInput}
                  />
                </div>

                <div className="controls">
                  <div className="control-group">
                    <label htmlFor="fontSizes">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Type size={16} /> Output Pixel Sizes (comma separated)
                      </div>
                    </label>
                    <input 
                      type="text" 
                      id="fontSizes" 
                      placeholder="e.g. 12, 16, 24"
                      value={sizesInput} 
                      onChange={(e) => setSizesInput(e.target.value)} 
                    />
                  </div>

                  <button 
                    className={`btn ${success ? 'success' : ''}`} 
                    onClick={handleConvert}
                    disabled={isConverting || files.length === 0}
                  >
                    {isConverting ? (
                      <>
                        <Loader2 className="animate-spin" /> Batch Converting...
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
          </>
        )}

        {activeTab === 'view' && (
          <>
            {!bdfChars ? (
              <div 
                className={`dropzone ${isDragActive ? 'active' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => bdfInputRef.current?.click()}
              >
                <div className="dropzone-icon">
                  <Eye size={48} strokeWidth={1.5} />
                </div>
                <h3>Drag & Drop a BDF file here</h3>
                <p>or click to browse</p>
                <input 
                  type="file" 
                  accept=".bdf" 
                  ref={bdfInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleViewFileInput}
                />
              </div>
            ) : (
              <div className="viewer-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px dashed var(--border-color)', paddingBottom: '1rem' }}>
                  <h3 style={{ textTransform: 'uppercase', fontSize: '1rem', wordBreak: 'break-all' }}>{viewFileName}</h3>
                  <button 
                    onClick={() => { setBdfChars(null); setViewFileName(null); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
                  >
                    Close
                  </button>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <p>Found {bdfChars.length} characters.</p>
                  
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <button 
                        disabled={viewerPage === 1}
                        onClick={() => setViewerPage(p => Math.max(1, p - 1))}
                        style={{ background: 'none', border: 'none', color: viewerPage === 1 ? '#555' : '#fff', cursor: viewerPage === 1 ? 'not-allowed' : 'pointer' }}
                      >
                        <ChevronLeft size={24} />
                      </button>
                      <span>Page {viewerPage} of {totalPages}</span>
                      <button 
                        disabled={viewerPage === totalPages}
                        onClick={() => setViewerPage(p => Math.min(totalPages, p + 1))}
                        style={{ background: 'none', border: 'none', color: viewerPage === totalPages ? '#555' : '#fff', cursor: viewerPage === totalPages ? 'not-allowed' : 'pointer' }}
                      >
                        <ChevronRight size={24} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="bdf-grid">
                  {currentChars.map((char, i) => (
                    <CharCard key={`${viewerPage}-${i}`} char={char} />
                  ))}
                </div>
                
                {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
                      <button 
                        disabled={viewerPage === 1}
                        onClick={() => setViewerPage(p => Math.max(1, p - 1))}
                        style={{ background: 'none', border: 'none', color: viewerPage === 1 ? '#555' : '#fff', cursor: viewerPage === 1 ? 'not-allowed' : 'pointer' }}
                      >
                        <ChevronLeft size={24} />
                      </button>
                      <span>Page {viewerPage} of {totalPages}</span>
                      <button 
                        disabled={viewerPage === totalPages}
                        onClick={() => setViewerPage(p => Math.min(totalPages, p + 1))}
                        style={{ background: 'none', border: 'none', color: viewerPage === totalPages ? '#555' : '#fff', cursor: viewerPage === totalPages ? 'not-allowed' : 'pointer' }}
                      >
                        <ChevronRight size={24} />
                      </button>
                    </div>
                  )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
