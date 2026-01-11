
import { LedgerEntry, TransactionType, FinancialChannel, Record, Expense, Purchase, CashTransfer, DebtItem, PlaceLoan, BankAccount, InventorySnapshot, PricingConfig, DayCycle, PeriodLock, SavingPlan } from './types';
import { generateId, getLocalDate, getDaysInMonth, getAllDaysOfMonth, formatCurrency } from './utils';

// --- SINGLE SOURCE OF TRUTH FOR PARTNERS ---
export const GLOBAL_PARTNERS = [
    { id: 'abu_khaled', name: 'أبو خالد', percent: 34 },
    { id: 'khaled', name: 'خالد', percent: 33 },
    { id: 'abdullah', name: 'عبد الله', percent: 33 }
];

// --- CORE SELECTORS ---

export const getLedgerBalance = (ledger: LedgerEntry[], channel: FinancialChannel, accountId?: string): number => {
    return ledger.reduce((acc, entry) => {
        if (entry.channel !== channel) return acc;
        if (accountId && entry.accountId !== accountId) return acc;

        // CRITICAL FIX: Partner-funded purchases do NOT increase physical cash/bank balances
        const isPartnerFundedPurchase = entry.type === TransactionType.PARTNER_DEPOSIT &&
                                         (entry.description.includes('شراء') || entry.description.includes('بضاعة'));

        if (isPartnerFundedPurchase) return acc;
        
        if (entry.direction === 'in') {
            if (channel === 'bank' && entry.transferStatus && entry.transferStatus !== 'confirmed') {
                return acc;
            }
            return acc + (entry.amount || 0);
        }
        if (entry.direction === 'out') return acc - (entry.amount || 0);
        return acc;
    }, 0);
};

export const getSavingsBalance = (ledger: LedgerEntry[]): number => {
    return ledger.reduce((acc, entry) => {
        if (entry.type === TransactionType.SAVING_DEPOSIT) return acc + entry.amount;
        if (entry.type === TransactionType.SAVING_WITHDRAWAL) return acc - entry.amount;
        return acc;
    }, 0);
};

export const resolveActorName = (entry: LedgerEntry): string => {
    if (entry.partnerName) return entry.partnerName;
    if (entry.partnerId) {
        const partner = GLOBAL_PARTNERS.find(p => p.id === entry.partnerId);
        if (partner) return partner.name;
    }
    if (entry.senderName) return entry.senderName;

    const types: { [key: string]: string } = {
        [TransactionType.INCOME_SESSION]: "زبون (جلسة)",
        [TransactionType.INCOME_PRODUCT]: "زبون (منتجات)",
        [TransactionType.DEBT_PAYMENT]: "زبون (سداد دين)",
        [TransactionType.DEBT_CREATE]: "زبون (تسجيل دين)",
        [TransactionType.EXPENSE_OPERATIONAL]: "مصاريف تشغيلية",
        [TransactionType.EXPENSE_PURCHASE]: "مشتريات للمكان",
        [TransactionType.LOAN_RECEIPT]: "دائن (قرض)",
        [TransactionType.LOAN_REPAYMENT]: "دائن (سداد)",
        [TransactionType.SAVING_DEPOSIT]: "صندوق الادخار",
        [TransactionType.LIQUIDATION_TO_APP]: "تطبيق / بنك"
    };

    return types[entry.type] || 'جهة غير محددة';
};

export const getLedgerStatsForPeriod = (ledger: LedgerEntry[], startDate: string, endDate: string) => {
    const periodEntries = ledger.filter(e => e.dateKey >= startDate && e.dateKey <= endDate);
    
    const income = periodEntries
        .filter(e => e.type === TransactionType.INCOME_SESSION || e.type === TransactionType.INCOME_PRODUCT || e.type === TransactionType.DEBT_PAYMENT)
        .reduce((s, e) => s + (e.amount || 0), 0);
    
    const sessionIncome = periodEntries.filter(e => e.type === TransactionType.INCOME_SESSION).reduce((s,e) => s + (e.amount || 0), 0);
    const productIncome = periodEntries.filter(e => e.type === TransactionType.INCOME_PRODUCT).reduce((s,e) => s + (e.amount || 0), 0);
    
    const expenses = periodEntries
        .filter(e => 
            e.type === TransactionType.EXPENSE_OPERATIONAL || 
            e.type === TransactionType.EXPENSE_PURCHASE ||
            (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة')))
        )
        .reduce((s, e) => s + (e.amount || 0), 0);
        
    const debtCreated = periodEntries
        .filter(e => e.type === TransactionType.DEBT_CREATE)
        .reduce((s, e) => s + (e.amount || 0), 0);
        
    const debtPaid = periodEntries
        .filter(e => e.type === TransactionType.DEBT_PAYMENT)
        .reduce((s, e) => s + (e.amount || 0), 0);
        
    const netCashFlow = periodEntries.reduce((acc, entry) => {
        if (entry.channel !== 'cash') return acc;
        if (entry.type === TransactionType.PARTNER_DEPOSIT && (entry.description.includes('شراء') || entry.description.includes('بضاعة'))) return acc;
        return entry.direction === 'in' ? acc + entry.amount : acc - entry.amount;
    }, 0);

    return { 
        income, sessionIncome, productIncome, expenses, debtCreated, debtPaid, 
        totalNetCash: getLedgerBalance(ledger, 'cash'), 
        totalNetBank: getLedgerBalance(ledger, 'bank'), 
        netCashFlow
    };
};

export const getLedgerTotals = (ledger: LedgerEntry[], period: 'today' | 'month' | 'custom', dateReference: string) => {
    let startDate = dateReference;
    let endDate = dateReference;
    if (period === 'month') {
        startDate = dateReference.slice(0, 7) + '-01';
        endDate = dateReference.slice(0, 7) + '-' + getDaysInMonth(startDate);
    }
    return getLedgerStatsForPeriod(ledger, startDate, endDate);
};

export const getPartnerStats = (ledger: LedgerEntry[], partnerId: string) => {
    const entries = ledger.filter(e => e.partnerId === partnerId);
    const withdrawals = entries.filter(e => e.type === TransactionType.PARTNER_WITHDRAWAL).reduce((s, e) => s + (e.amount || 0), 0);
    const repayments = entries.filter(e => e.type === TransactionType.PARTNER_DEPOSIT || e.type === TransactionType.PARTNER_DEBT_PAYMENT).reduce((s, e) => s + (e.amount || 0), 0);
    return { withdrawals, repayments, currentNet: withdrawals - repayments, entries };
};

export const getTreasuryStats = (ledger: LedgerEntry[], accounts: BankAccount[]) => {
    return {
        cashBalance: getLedgerBalance(ledger, 'cash'),
        totalBankBalance: getLedgerBalance(ledger, 'bank'),
        accountsStats: accounts.map(acc => ({
            ...acc,
            balance: getLedgerBalance(ledger, 'bank', acc.id),
            totalIn: ledger.filter(e => e.accountId === acc.id && e.direction === 'in' && (e.transferStatus === 'confirmed' || !e.transferStatus)).reduce((s,e) => s+e.amount, 0),
            totalOut: ledger.filter(e => e.accountId === acc.id && e.direction === 'out').reduce((s,e) => s+e.amount, 0)
        }))
    };
};

export const getPartnerDebtSummary = (debtsList: DebtItem[], partnerId: string) => {
    const items = debtsList.filter(d => d.partnerId === partnerId);
    const totalDebt = items.reduce((sum, d) => sum + (d.amount || 0), 0);
    const placeDebt = items.filter(d => d.debtSource === 'place' || !d.debtSource).reduce((sum, d) => sum + (d.amount || 0), 0);
    return { totalDebt, placeDebt, items };
};

export const getPlaceLoanStats = (loan: PlaceLoan) => {
    const paid = loan.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = loan.principal - paid;
    const progress = loan.principal > 0 ? Math.min(100, (paid / loan.principal) * 100) : 0;
    return { paid, remaining, progress, isFullyPaid: remaining <= 0.01 };
};

export const checkLoanStatusAfterPayment = (loan: PlaceLoan, newAmount: number): 'active' | 'closed' => {
     const currentPaid = loan.payments.reduce((s, p) => s + p.amount, 0);
     return (currentPaid + newAmount) >= (loan.principal - 0.01) ? 'closed' : 'active';
};

export const getCostAnalysisView = (ledger: LedgerEntry[], records: Record[], monthKey: string) => {
    const days = getAllDaysOfMonth(monthKey);
    return days.map(date => {
        const periodEntries = ledger.filter(e => e.dateKey === date);
        const dayRecords = records.filter(r => r.endTime.startsWith(date));

        const income = periodEntries.filter(e => e.type === TransactionType.INCOME_SESSION || e.type === TransactionType.INCOME_PRODUCT || e.type === TransactionType.DEBT_PAYMENT).reduce((s, e) => s + (e.amount || 0), 0);
        
        // Correctly sum all expense types for the analysis view
        const allExpenses = periodEntries.filter(e => 
            e.type === TransactionType.EXPENSE_OPERATIONAL || 
            e.type === TransactionType.EXPENSE_PURCHASE ||
            (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة')))
        ).reduce((s, e) => s + (e.amount || 0), 0);

        const savings = periodEntries.filter(e => e.type === TransactionType.SAVING_DEPOSIT).reduce((s, e) => s + (e.amount || 0), 0);
        const loanRepayments = periodEntries.filter(e => e.type === TransactionType.LOAN_REPAYMENT).reduce((s, e) => s + (e.amount || 0), 0);
        const cogs = dayRecords.reduce((s, r) => s + (r.drinksCost || 0) + (r.internetCardsCost || 0) + (r.placeCost || 0), 0);

        return {
            date,
            totalRevenue: income,
            totalExpenses: allExpenses,
            totalSavings: savings,
            totalLoanRepayments: loanRepayments,
            totalCOGS: cogs,
            netProfit: income - (allExpenses + cogs + savings + loanRepayments),
        };
    }).filter(d => d.totalRevenue > 0 || d.totalExpenses > 0 || d.totalSavings > 0 || d.totalLoanRepayments > 0);
};

export const calcLedgerInventory = (ledger: LedgerEntry[], records: Record[], startDate: string, endDate: string, expenses: Expense[], pricingConfig: PricingConfig, electricityCost: number = 0, lastInventoryAt?: string): InventorySnapshot => {
    // Filter ledger by date range and, if provided, by timestamp > lastInventoryAt
    const periodEntries = ledger.filter(e => {
        if (e.dateKey < startDate || e.dateKey > endDate) return false;
        if (lastInventoryAt && e.timestamp && e.timestamp <= lastInventoryAt) return false;
        return true;
    });
    
    const isPhysicalIn = (e: LedgerEntry) => {
        if (e.direction !== 'in') return false;
        if (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة'))) return false;
        return true;
    };

    const cashIn = periodEntries.filter(e => e.channel === 'cash' && isPhysicalIn(e)).reduce((s,e) => s + e.amount, 0);
    const bankIn = periodEntries.filter(e => e.channel === 'bank' && isPhysicalIn(e) && (e.transferStatus === 'confirmed' || !e.transferStatus)).reduce((s,e) => s + e.amount, 0);
    const cashOut = periodEntries.filter(e => e.channel === 'cash' && e.direction === 'out').reduce((s,e) => s + e.amount, 0);
    const bankOut = periodEntries.filter(e => e.channel === 'bank' && e.direction === 'out').reduce((s,e) => s + e.amount, 0);

    const netCashInPlace = cashIn - cashOut;
    const netBankInPlace = bankIn - bankOut;

    const periodRecords = records.filter(r => {
        const rDate = r.endTime.split('T')[0];
        if (rDate < startDate || rDate > endDate) return false;
        if (lastInventoryAt && r.endTime && r.endTime <= lastInventoryAt) return false;
        return true;
    });
    const totalCOGS = periodRecords.reduce((s, r) => s + (r.drinksCost || 0) + (r.internetCardsCost || 0) + (r.placeCost || 0), 0);
    
    // Summing all categories of expenses to ensure they appear in the UI and aren't 0
    const totalOpsExpenses = periodEntries.filter(e => 
        e.type === TransactionType.EXPENSE_OPERATIONAL || 
        e.type === TransactionType.EXPENSE_PURCHASE ||
        (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة')))
    ).reduce((s, e) => s + e.amount, 0) + electricityCost;

    const totalLoanRepayments = periodEntries.filter(e => e.type === TransactionType.LOAN_REPAYMENT).reduce((s, e) => s + e.amount, 0);
    const totalSavings = periodEntries.filter(e => e.type === TransactionType.SAVING_DEPOSIT).reduce((s, e) => s + e.amount, 0);

    const totalRevenue = periodEntries.filter(e => 
        e.type === TransactionType.INCOME_SESSION || 
        e.type === TransactionType.INCOME_PRODUCT || 
        e.type === TransactionType.DEBT_PAYMENT
    ).reduce((s,e) => s+e.amount, 0);
    
    // Profit Logic: Revenue - (Expenses + COGS + Loans + Savings)
    const netProfitPaid = totalRevenue - (totalOpsExpenses + totalCOGS + totalLoanRepayments + totalSavings);
    const devCut = netProfitPaid > 0 ? netProfitPaid * (pricingConfig.devPercent / 100) : 0;
    const distributableProfit = netProfitPaid - devCut;

    const partners = GLOBAL_PARTNERS.map(p => {
        const baseShare = Math.max(0, distributableProfit * (p.percent / 100));
        const myPurchases = periodEntries.filter(e => e.partnerId === p.id && e.type === TransactionType.PARTNER_DEPOSIT && e.description.includes('شراء')).reduce((s,e) => s+e.amount, 0);
        const myWithdrawals = periodEntries.filter(e => e.partnerId === p.id && e.type === TransactionType.PARTNER_WITHDRAWAL).reduce((s,e) => s+e.amount, 0);

        const opsNetCash = netCashInPlace + myPurchases + myWithdrawals;
        const totalOpsNet = opsNetCash + netBankInPlace;
        const cashRatio = totalOpsNet > 0 ? Math.max(0, opsNetCash) / totalOpsNet : 0.5;
        const bankRatio = 1 - cashRatio;

        const finalPayoutCash = (baseShare * cashRatio) + myPurchases - myWithdrawals;
        const finalPayoutBank = (baseShare * bankRatio);

        return {
            name: p.name, sharePercent: p.percent / 100, baseShare,
            cashShareAvailable: baseShare * cashRatio, bankShareAvailable: baseShare * bankRatio,
            purchasesReimbursement: myPurchases, loanRepaymentCash: 0, loanRepaymentBank: 0,
            placeDebtDeducted: myWithdrawals, finalPayoutCash, finalPayoutBank,
            finalPayoutTotal: finalPayoutCash + finalPayoutBank, remainingDebt: 0
        };
    });

    return {
        id: generateId(), type: 'manual', archiveId: 'SNAP-' + generateId(), archiveDate: new Date().toISOString(),
        periodStart: startDate, periodEnd: endDate, createdAt: Date.now(), 
        totalPaidRevenue: totalRevenue, totalCashRevenue: cashIn, totalBankRevenue: bankIn,
        totalDiscounts: 0, totalDebtRevenue: 0, totalInvoice: totalRevenue,
        totalPlaceCost: periodRecords.reduce((s,r) => s+(r.placeCost||0), 0),
        totalDrinksCost: periodRecords.reduce((s,r) => s+(r.drinksCost||0), 0),
        totalCardsCost: periodRecords.reduce((s,r) => s+(r.internetCardsCost||0), 0),
        totalExpenses: totalOpsExpenses, totalCOGS, totalLoanRepayments, totalSavings, electricityCost,
        totalCashExpenses: cashOut, totalBankExpenses: bankOut, netCashInPlace, netBankInPlace,
        grossProfit: netProfitPaid + devCut, devCut, netProfitPaid: distributableProfit, devPercentSnapshot: pricingConfig.devPercent, partners,
        expensesDetails: { fixed: [], oneTime: [], autoPurchases: [], loanRepayments: [] }
    };
};

export const validateTransaction = (ledger: LedgerEntry[], amount: number, channel: FinancialChannel, accountId?: string) => {
    const balance = getLedgerBalance(ledger, channel, accountId);
    if (balance < amount) {
        throw new Error(`رصيد ${channel === 'cash' ? 'الكاش' : 'البنك'} غير كافٍ. الرصيد الحالي: ${formatCurrency(balance)}`);
    }
};

export const createEntry = (
    type: TransactionType,
    amount: number,
    direction: 'in' | 'out',
    channel: FinancialChannel,
    description: string,
    accountId?: string,
    entityId?: string,
    partnerId?: string,
    dateKey?: string,
    referenceId?: string,
    partnerName?: string,
    performedById?: string,
    performedByName?: string
): LedgerEntry => ({
    id: generateId(),
    timestamp: new Date().toISOString(),
    dateKey: dateKey || getLocalDate(),
    type,
    amount,
    direction,
    channel,
    accountId,
    entityId,
    description,
    partnerId,
    partnerName,
    referenceId,
    performedById,
    performedByName
});

export const calcEndDayPreviewFromLedger = (ledger: LedgerEntry[], startTime: string, bankAccounts: BankAccount[], config: PricingConfig) => {
    const today = getLocalDate();
    const stats = getLedgerStatsForPeriod(ledger, today, today);
    const bankBreakdown = bankAccounts.map(acc => ({
        bankName: acc.name,
        amount: getLedgerBalance(ledger, 'bank', acc.id)
    })).filter(b => b.amount !== 0);

    return {
        totalRevenue: stats.income,
        cashRevenue: stats.sessionIncome + stats.productIncome,
        bankRevenue: stats.totalNetBank,
        totalDebt: stats.debtCreated,
        netCashFlow: stats.netCashFlow,
        recordCount: 0,
        bankBreakdown
    };
};

export const validateOperation = (date: string, lock: PeriodLock | null) => {
    if (lock && date <= lock.lockedUntil) {
        throw new Error(`الفترة المالية مغلقة حتى تاريخ ${lock.lockedUntil}. لا يمكن إجراء عمليات في هذا التاريخ.`);
    }
};

export const processAutoSavings = (plans: SavingPlan[], ledger: LedgerEntry[], date: string) => {
    const entries: LedgerEntry[] = [];
    const updatedPlans = plans.map(plan => {
        if (!plan.isActive) return plan;
        const lastApplied = plan.lastAppliedAt;
        if (lastApplied >= date) return plan;
        if (plan.type === 'daily_saving') {
            entries.push(createEntry(TransactionType.SAVING_DEPOSIT, plan.amount, 'out', plan.channel, `ادخار تلقائي: ${plan.name || 'خطة ادخار'}`, plan.bankAccountId, undefined, undefined, date));
            return { ...plan, lastAppliedAt: date };
        }
        if (plan.type === 'monthly_payment') {
            const currentMonth = date.slice(0, 7);
            const lastMonth = lastApplied.slice(0, 7);
            if (currentMonth > lastMonth) {
                entries.push(createEntry(TransactionType.SAVING_DEPOSIT, plan.amount, 'out', plan.channel, `ادخار شهري: ${plan.name || 'خطة ادخار'}`, plan.bankAccountId, undefined, undefined, date));
                return { ...plan, lastAppliedAt: date };
            }
        }
        return plan;
    });
    return { entries, updatedPlans };
};

export const migrateLegacyDataToLedger = (records: Record[], expenses: Expense[], cashTransfers: CashTransfer[], debts: DebtItem[], loans: PlaceLoan[]): LedgerEntry[] => {
    return [];
};

export const checkLedgerIntegrity = (ledger: LedgerEntry[]): string[] => {
    const errors: string[] = [];
    if (ledger.some(e => !e.amount || e.amount < 0)) errors.push("يوجد عمليات بمبالغ غير صحيحة");
    return errors;
};

export const getExpensesPageStats = (purchases: Purchase[], plans: SavingPlan[], monthKey: string) => {
    const totalDaily = purchases.filter(p => p.date.startsWith(monthKey)).reduce((sum, p) => sum + p.amount, 0);
    const fixedPlans = plans.filter(p => p.category === 'expense' && p.isActive);
    const totalFixedMonthly = fixedPlans.reduce((sum, p) => sum + p.amount, 0);
    const totalDailyFixed = fixedPlans.filter(p => p.type === 'daily_saving').reduce((sum, p) => sum + p.amount, 0);
    return { totalDaily, totalFixedMonthly, totalDailyFixed };
};

export const getSnapshotDistributionTotals = (snap: InventorySnapshot) => {
    const totalCashDist = snap.partners.reduce((s, p) => s + (p.finalPayoutCash || 0), 0);
    const totalBankDist = snap.partners.reduce((s, p) => s + (p.finalPayoutBank || 0), 0);
    return { totalCashDist, totalBankDist };
};
