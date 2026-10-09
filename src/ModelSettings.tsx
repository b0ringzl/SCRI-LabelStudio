import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { adapterFor, normalizeEndpoint } from './modelRegistry';
import type { ModelAdapterId, ModelModality, ModelProfile } from './modelRegistry';
import './modelSettings.css';

interface Props {
  profiles: ModelProfile[];
  selected: Record<ModelModality, string>;
  onProfilesChange: (profiles: ModelProfile[]) => void;
  onSelectionChange: (selected: Record<ModelModality, string>) => void;
}

export default function ModelSettings({ profiles, selected, onProfilesChange, onSelectionChange }: Props) {
  const [name, setName] = useState('');
  const [modality, setModality] = useState<ModelModality>('image2d');
  const [endpoint, setEndpoint] = useState('');
  const [adapter, setAdapter] = useState<ModelAdapterId>('atlas-image-v1');
  const [modelName, setModelName] = useState('qwen3-vl-plus');
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');

  function saveProfile() {
    try {
      const cleanName = name.trim();
      if (!cleanName) throw new Error('请填写模型名称');
      const isVisionLlm = adapter === 'qwen-vl-v1' || adapter === 'deepseek-vision-v1';
      const cleanEndpoint = isVisionLlm ? '' : normalizeEndpoint(endpoint);
      const cleanModelName = modelName.trim();
      if (adapter === 'qwen-vl-v1' && !/^qwen[\w.-]{1,80}$/i.test(cleanModelName)) throw new Error('请填写千问视觉模型名，例如 qwen3-vl-plus');
      if (adapter === 'deepseek-vision-v1' && !/^deepseek[\w.-]{1,80}$/i.test(cleanModelName)) throw new Error('请填写 DeepSeek 视觉模型名，例如 deepseek-flash');
      const profile: ModelProfile = { id: editingId || `model-${crypto.randomUUID()}`,
        name: cleanName, modality, adapter, endpoint: cleanEndpoint,
        ...(isVisionLlm ? { modelName: cleanModelName } : {}) };
      const previousProfile = profiles.find((item) => item.id === editingId);
      const next = editingId ? profiles.map((item) => item.id === editingId ? profile : item) : [...profiles, profile];
      onProfilesChange(next);
      const nextSelection = { ...selected };
      if (previousProfile && previousProfile.modality !== modality && nextSelection[previousProfile.modality] === profile.id) {
        nextSelection[previousProfile.modality] = '';
      }
      if (!nextSelection[modality]) nextSelection[modality] = profile.id;
      onSelectionChange(nextSelection);
      setName(''); setEndpoint(''); setModelName('qwen3-vl-plus'); setEditingId(''); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '模型配置无效'); }
  }

  function edit(profile: ModelProfile) {
    setEditingId(profile.id); setName(profile.name); setModality(profile.modality);
    setEndpoint(profile.endpoint); setAdapter(profile.adapter); setModelName(profile.modelName ?? 'qwen3-vl-plus'); setError('');
  }

  function remove(profile: ModelProfile) {
    onProfilesChange(profiles.filter((item) => item.id !== profile.id));
    if (selected[profile.modality] === profile.id) onSelectionChange({ ...selected, [profile.modality]: '' });
    if (editingId === profile.id) { setEditingId(''); setName(''); setEndpoint(''); }
  }

  return <div className="model-manager">
    <section className="model-manager-panel"><h2>模型服务列表</h2><p>同一种数据可配置多个服务，并在标注页切换。配置保存在当前浏览器；密钥只从本机启动环境读取。点击“运行”后才发送当前任务影像。</p>
      {(['image2d', 'paired3d'] as ModelModality[]).map((kind) => <div className="model-kind" key={kind}>
        <div className="model-kind-head"><strong>{kind === 'image2d' ? '普通图片 · 2D 框' : '点云 + 全景 · 联合标注'}</strong><span>可切换适配器</span></div>
        {profiles.filter((profile) => profile.modality === kind).map((profile) => <div className="model-row" key={profile.id}>
          <label><input type="radio" name={`active-${kind}`} checked={selected[kind] === profile.id}
            onChange={() => onSelectionChange({ ...selected, [kind]: profile.id })} /><span><strong>{profile.name}</strong><small>{profile.adapter === 'qwen-vl-v1' ? `千问视觉 · ${profile.modelName} · 本机代理` : profile.adapter === 'deepseek-vision-v1' ? `DeepSeek 视觉 · ${profile.modelName} · 本机代理` : profile.endpoint}</small></span></label>
          <button onClick={() => edit(profile)}>编辑</button><button aria-label={`删除 ${profile.name}`} onClick={() => remove(profile)}><Trash2 size={15} /></button>
        </div>)}
        {!profiles.some((profile) => profile.modality === kind) && <p className="model-empty">尚未配置模型</p>}
      </div>)}
    </section>
    <section className="model-manager-panel model-form"><h2>{editingId ? '编辑模型服务' : '新增模型服务'}</h2>
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：道路设施检测 v2" /></label>
      <label>适用数据<select value={modality} onChange={(event) => { const next = event.target.value as ModelModality; setModality(next); if (adapter !== 'qwen-vl-v1' && adapter !== 'deepseek-vision-v1') setAdapter(adapterFor(next)); }}><option value="image2d">普通图片 · 2D 框</option><option value="paired3d">点云 + 全景</option></select></label>
      <label>适配方式<select value={adapter} onChange={(event) => { const next = event.target.value as ModelAdapterId; setAdapter(next); if (next === 'qwen-vl-v1') setModelName('qwen3-vl-plus'); if (next === 'deepseek-vision-v1') setModelName('deepseek-flash'); }}><option value={adapterFor(modality)}>标准 HTTP 模型</option><option value="qwen-vl-v1">千问视觉 · 本机代理</option><option value="deepseek-vision-v1">DeepSeek 视觉 · 本机代理</option></select></label>
      {adapter === 'qwen-vl-v1' || adapter === 'deepseek-vision-v1' ? <><label>模型名称<input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={adapter === 'qwen-vl-v1' ? 'qwen3-vl-plus' : 'deepseek-flash'} /></label><small>需先在本机启动服务时设置对应提供方的 API Key 与模型允许列表。密钥不会保存到浏览器。全景模式只生成影像区域候选，不生成 3D 框。</small></> : <><label>服务根地址<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:8000/api" /></label><small>服务实现 POST /assets 和 POST /predict；详见 docs/MODEL_API.md。</small></>}
      {error && <p className="model-form-error" role="alert">{error}</p>}
      <div className="model-form-actions"><button onClick={saveProfile}><Plus size={16} />{editingId ? '保存配置' : '添加模型'}</button>{editingId && <button onClick={() => { setEditingId(''); setName(''); setEndpoint(''); setError(''); }}>取消编辑</button>}</div>
    </section>
  </div>;
}
