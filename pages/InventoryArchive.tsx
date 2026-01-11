
import React, { useState } from 'react';
import { InventorySnapshot, Record, SystemState, Expense, Purchase, DebtItem, PricingConfig, PlaceLoan, LedgerEntry } from '../types';
import { formatCurrency } from '../utils';
import { 
  Archive, ChevronDown, ChevronUp, Calendar, Trash2, Download, 
  RefreshCw, BarChart3, TrendingUp, Database, Fingerprint, Tag, 
  AlertTriangle, Clock, Banknote, Landmark, TrendingDown, 
  Coffee, ShoppingBag, Zap, Calculator, Users,
  // Added missing ShieldCheck and UserCheck imports
  ShieldCheck, UserCheck 
} from 'lucide-react';
import Button from '../components/ui/Button';
import ConfirmModal from '../components/ui/ConfirmModal';
import { getSnapshotDistributionTotals } from '../accounting_core';

// @ts-ignore
import * as XLSX from 'xlsx';

interface InventoryArchiveProps {
  snapshots: InventorySnapshot[];
  onUpdateSnapshots?: (newSnapshots: InventorySnapshot[]) => void;
  records: Record[];
  expenses: Expense[];
  purchases: Purchase[];
  debtsList: DebtItem[];
  pricingConfig: PricingConfig;
  placeLoans: PlaceLoan[];
  onDelete: (id: string) => void;
  systemState?: SystemState;
  ledger: LedgerEntry[];
}

const InventoryArchive: React.FC<InventoryArchiveProps> = ({ 
    snapshots, onDelete
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleExportExcel = (snapshot: InventorySnapshot) => {
      const summaryData = [
          { 'البيان': 'معرف الأرشيف', 'القيمة': snapshot.archiveId },
          { 'البيان': 'تاريخ الأرشفة', 'القيمة': new Date(snapshot.createdAt).toLocaleDateString('ar-SA') },
          { 'البيان': 'الفترة من', 'القيمة': snapshot.periodStart },
          { 'البيان': 'الفترة إلى', 'القيمة': snapshot.periodEnd },
          { 'البيان': '', 'القيمة': '' }, 
          { 'البيان': 'إجمالي الإيرادات', 'القيمة': snapshot.totalPaidRevenue },
          { 'البيان': 'المصاريف التشغيلية', 'القيمة': snapshot.totalExpenses },
          { 'البيان': 'تكلفة البضاعة (COGS)', 'القيمة': snapshot.totalCOGS || 0 },
          { 'البيان': 'سداد الالتزامات (قروض)', 'القيمة': snapshot.totalLoanRepayments || 0 },
          { 'البيان': 'الادخار', 'القيمة': snapshot.totalSavings || 0 },
          { 'البيان': 'الربح الإجمالي (Gross)', 'القيمة': snapshot.grossProfit },
          { 'البيان': 'مبلغ التطوير المخصوم', 'القيمة': snapshot.devCut },
          { 'البيان': 'صافي الربح الموزع', 'القيمة': snapshot.netProfitPaid },
          { 'البيان': '', 'القيمة': '' },
          { 'البيان': 'صافي الكاش وقت الجرد', 'القيمة': snapshot.netCashInPlace },
          { 'البيان': 'صافي البنك وقت الجرد', 'القيمة': snapshot.netBankInPlace },
      ];

      const partnersData = snapshot.partners.map(p => ({
          'اسم الشريك': p.name,
          'النسبة %': p.sharePercent * 100 + '%',
          'الحصة الأساسية': p.baseShare,
          'صافي الاستحقاق (كاش)': p.finalPayoutCash,
          'صافي الاستحقاق (بنك)': p.finalPayoutBank,
          'الإجمالي النهائي': p.finalPayoutTotal
      }));

      const wb = XLSX.utils.book_new();
      
      const addSheet = (data: any[], name: string) => {
          const ws = XLSX.utils.json_to_sheet(data);
          if(!ws['!views']) ws['!views'] = [];
          ws['!views'].push({ rightToLeft: true });
          XLSX.utils.book_append_sheet(wb, ws, name);
      };

      addSheet(summaryData, "الملخص المالي");
      addSheet(partnersData, "توزيع الشركاء");

      XLSX.writeFile(wb, `Report_${snapshot.archiveId}.xlsx`);
  };

  const renderVal = (val: any, isCurrency = true) => {
      if (val === undefined || val === null) return <span className="text-gray-300">0.00 ₪</span>;
      return isCurrency ? formatCurrency(Number(val)) : val;
  };

  if (snapshots.length === 0) return (
    <div className="text-center py-20 bg-white rounded-[32px] border-2 border-dashed border-gray-200">
        <Archive className="mx-auto h-16 w-16 text-gray-200 mb-4"/>
        <h3 className="text-lg font-bold text-gray-400">لا يوجد بيانات مؤرشفة حالياً</h3>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in text-gray-900 pb-10">
      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-3 rounded-2xl text-white shadow-lg shadow-indigo-100"><Archive size={24} /></div>
            <div>
                <h2 className="text-2xl font-black text-gray-800">الأرشيف والتوثيق المالي</h2>
                <p className="text-gray-500 text-sm font-medium mt-1">سجل الحسابات والنتائج المالية للفترات السابقة.</p>
            </div>
        </div>
      </div>

      <div className="space-y-4">
        {snapshots.slice().reverse().map(snapshot => {
          const { totalCashDist, totalBankDist } = getSnapshotDistributionTotals(snapshot);
          const isLoss = snapshot.netProfitPaid < 0;

          // CALCULATE ALL DEDUCTIONS (Operational + COGS + Loans + Savings)
          const totalOpsAndCOGS = (snapshot.totalExpenses || 0) + (snapshot.totalCOGS || 0);
          const totalObligations = (snapshot.totalLoanRepayments || 0) + (snapshot.totalSavings || 0);
          const actualDeductedTotal = totalOpsAndCOGS + totalObligations;

          return (
            <div key={snapshot.id} className="bg-white rounded-[32px] shadow-soft border border-gray-100 overflow-hidden transition-all duration-300 group">
              
              <div 
                onClick={() => toggleExpand(snapshot.id)}
                className={`p-6 flex flex-col md:flex-row items-center justify-between cursor-pointer transition-colors ${expandedId === snapshot.id ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-5 w-full md:w-auto">
                  <div className={`p-4 rounded-2xl transition-all ${expandedId === snapshot.id ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
                      <Calendar size={22} />
                  </div>
                  <div>
                    <h3 className="font-black text-lg text-gray-800 flex items-center gap-2">
                        أرشيف {snapshot.periodEnd.slice(0, 7)}
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-white border border-gray-200 text-gray-500 font-black uppercase tracking-widest">{snapshot.archiveId}</span>
                    </h3>
                    <p className="text-xs text-gray-400 mt-1 font-bold flex items-center gap-1"><Clock size={12}/> تم الأرشفة في {new Date(snapshot.createdAt).toLocaleDateString('ar-SA')}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-8 mt-6 md:mt-0">
                   <div className="text-left border-l border-gray-200 pl-8">
                      <p className="text-[10px] font-black text-gray-400 uppercase mb-1 tracking-widest">صافي الربح الموزع</p>
                      <p className={`text-xl font-black ${isLoss ? 'text-rose-600' : 'text-indigo-600'}`}>
                          {formatCurrency(snapshot.netProfitPaid + (snapshot.devCut || 0))}
                      </p>
                   </div>
                   <div className="flex items-center gap-3">
                      <button onClick={(e) => { e.stopPropagation(); handleExportExcel(snapshot); }} className="p-2.5 text-gray-400 hover:text-indigo-600 hover:bg-white rounded-xl border border-transparent hover:border-indigo-100 transition-all shadow-sm" title="تصدير Excel"><Download size={20}/></button>
                      <button onClick={(e) => { e.stopPropagation(); setDeleteId(snapshot.id); }} className="p-2.5 text-gray-400 hover:text-rose-600 hover:bg-white rounded-xl border border-transparent hover:border-rose-100 transition-all shadow-sm" title="حذف"><Trash2 size={20} /></button>
                       {expandedId === snapshot.id ? <ChevronUp className="text-indigo-600"/> : <ChevronDown className="text-gray-400"/>}
                   </div>
                </div>
              </div>

              {expandedId === snapshot.id && (
                <div className="p-8 bg-white border-t border-gray-100 animate-fade-in space-y-8">
                  
                  {/* Summary Grid matching Cost Analysis logic */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="bg-emerald-50 p-5 rounded-3xl border border-emerald-100">
                          <p className="text-[10px] font-black text-emerald-600 uppercase mb-1 tracking-widest flex items-center gap-1"><TrendingUp size={12}/> إجمالي الإيرادات</p>
                          <p className="text-2xl font-black text-emerald-800">{formatCurrency(snapshot.totalPaidRevenue)}</p>
                      </div>
                      <div className="bg-rose-50 p-5 rounded-3xl border border-rose-100">
                          <p className="text-[10px] font-black text-rose-600 uppercase mb-1 tracking-widest flex items-center gap-1"><TrendingDown size={12}/> مصاريف وتكاليف</p>
                          <p className="text-2xl font-black text-rose-800">{formatCurrency(totalOpsAndCOGS)}</p>
                      </div>
                      <div className="bg-amber-50 p-5 rounded-3xl border border-amber-100">
                          <p className="text-[10px] font-black text-amber-600 uppercase mb-1 tracking-widest flex items-center gap-1"><ShieldCheck size={12}/> التزامات وادخار</p>
                          <p className="text-2xl font-black text-amber-800">{formatCurrency(totalObligations)}</p>
                      </div>
                      <div className="bg-indigo-600 p-5 rounded-3xl text-white shadow-lg shadow-indigo-100">
                          <p className="text-[10px] font-black text-indigo-100 uppercase mb-1 tracking-widest flex items-center gap-1"><Zap size={12}/> صافي الربح</p>
                          <p className="text-2xl font-black">{formatCurrency(snapshot.netProfitPaid + (snapshot.devCut || 0))}</p>
                      </div>
                  </div>

                  {/* Accounting Table for Deep Audit */}
                  <div className="bg-white rounded-[24px] border border-gray-200 overflow-hidden shadow-sm">
                      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                          <h4 className="font-black text-gray-800 text-sm flex items-center gap-2">
                              <Calculator size={16} className="text-indigo-600"/>
                              بيانات التدقيق المالي المؤرشفة
                          </h4>
                      </div>
                      <div className="overflow-x-auto">
                          <table className="min-w-full text-right text-sm">
                              <thead className="bg-gray-50/50 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                                  <tr>
                                      <th className="px-6 py-3">البيان المالي</th>
                                      <th className="px-6 py-3">القيمة المسجلة</th>
                                      <th className="px-6 py-3">التوضيح</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                  <tr>
                                      <td className="px-6 py-4 font-bold text-gray-700">المبيعات المحصلة</td>
                                      <td className="px-6 py-4 font-black text-emerald-600">{renderVal(snapshot.totalPaidRevenue)}</td>
                                      <td className="px-6 py-4 text-xs text-gray-400">إجمالي دخل الجلسات والمنتجات</td>
                                  </tr>
                                  <tr>
                                      <td className="px-6 py-4 font-bold text-gray-700">المصاريف التشغيلية</td>
                                      <td className="px-6 py-4 font-black text-rose-600">{renderVal(snapshot.totalExpenses)}</td>
                                      <td className="px-6 py-4 text-xs text-gray-400">تشمل المشتريات، الصيانة، والكهرباء</td>
                                  </tr>
                                  <tr>
                                      <td className="px-6 py-4 font-bold text-gray-700">تكلفة البضاعة (Direct Cost)</td>
                                      <td className="px-6 py-4 font-black text-rose-600">{renderVal(snapshot.totalCOGS)}</td>
                                      <td className="px-6 py-4 text-xs text-gray-400">تكلفة المواد الخام المستهلكة فعلياً</td>
                                  </tr>
                                  <tr>
                                      <td className="px-6 py-4 font-bold text-gray-700">سداد الديون والالتزامات</td>
                                      <td className="px-6 py-4 font-black text-amber-600">{renderVal(snapshot.totalLoanRepayments)}</td>
                                      <td className="px-6 py-4 text-xs text-gray-400">أقساط القروض التي تم سدادها</td>
                                  </tr>
                                  <tr>
                                      <td className="px-6 py-4 font-bold text-gray-700">الادخار المقتطع</td>
                                      <td className="px-6 py-4 font-black text-purple-600">{renderVal(snapshot.totalSavings)}</td>
                                      <td className="px-6 py-4 text-xs text-gray-400">مبالغ تم ترحيلها لصندوق الطوارئ</td>
                                  </tr>
                                  <tr className="bg-indigo-50/30">
                                      <td className="px-6 py-4 font-black text-indigo-900">إجمالي المقتطعات</td>
                                      <td className="px-6 py-4 font-black text-rose-700 underline decoration-2">{renderVal(actualDeductedTotal)}</td>
                                      <td className="px-6 py-4 text-xs font-bold text-indigo-400">مجموع كافة الخصومات أعلاه</td>
                                  </tr>
                              </tbody>
                          </table>
                      </div>
                  </div>

                  {/* Distributions Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                          <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex justify-between items-center">
                              <h4 className="font-black text-emerald-900 text-xs uppercase tracking-widest flex items-center gap-2"><Banknote size={16}/> التوزيع النقدي (كاش)</h4>
                              <p className="font-black text-emerald-700">{formatCurrency(totalCashDist)}</p>
                          </div>
                          <div className="p-4">
                              <table className="min-w-full text-right text-xs">
                                  <tbody className="divide-y divide-gray-50">
                                      {snapshot.partners.map((p, idx) => (
                                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                              <td className="py-3 px-2 font-bold text-gray-700">{p.name}</td>
                                              <td className="py-3 px-2 font-black text-emerald-600 text-left">{renderVal(p.finalPayoutCash)}</td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>

                      <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                          <div className="bg-blue-50 px-6 py-4 border-b border-blue-100 flex justify-between items-center">
                              <h4 className="font-black text-blue-900 text-xs uppercase tracking-widest flex items-center gap-2"><Landmark size={16}/> التوزيع البنكي (تطبيق)</h4>
                              <p className="font-black text-blue-700">{formatCurrency(totalBankDist)}</p>
                          </div>
                          <div className="p-4">
                              <table className="min-w-full text-right text-xs">
                                  <tbody className="divide-y divide-gray-50">
                                      {snapshot.partners.map((p, idx) => (
                                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                              <td className="py-3 px-2 font-bold text-gray-700">{p.name}</td>
                                              <td className="py-3 px-2 font-black text-blue-600 text-left">{renderVal(p.finalPayoutBank)}</td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                  </div>

                  <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-200">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-gray-400 border border-gray-100"><UserCheck size={18}/></div>
                      <div>
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">الموظف المسؤول عن الأرشفة</p>
                          <p className="text-sm font-bold text-gray-700">{snapshot.performedById || 'مسؤول النظام'}</p>
                      </div>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal 
        isOpen={!!deleteId} 
        onClose={() => setDeleteId(null)} 
        onConfirm={() => { if(deleteId) onDelete(deleteId); }} 
        message="هل أنت متأكد من حذف هذا السجل؟ سيتم حذف بيانات التوثيق لهذه الفترة نهائياً." 
      />
    </div>
  );
};

export default InventoryArchive;
