import { isMobile } from "is-mobile";
import type {
  WalletSelectorStore,
  WalletModuleFactory,
  WalletBehaviourFactory,
  InjectedWallet,
  AccountState,
  Optional,
  Transaction,
} from "@near-wallet-selector/core";
import { waitFor } from "@near-wallet-selector/core";
import type { InjectedMathWallet } from "./injected-math-wallet";
import { signTransactions } from "@near-wallet-selector/wallet-utils";

declare global {
  interface Window {
    nearWalletApi: InjectedMathWallet | undefined;
  }
}

export interface MathWalletParams {
  iconUrl?: string;
}

interface MathWalletState {
  wallet: InjectedMathWallet;
}

const isInstalled = () => {
  return waitFor(() => !!window.nearWalletApi).catch(() => false);
};

const setupMathWalletState = async (
  store: WalletSelectorStore
): Promise<MathWalletState> => {
  const wallet = window.nearWalletApi!;
  const { contract } = store.getState();

  // This wallet currently has weird behaviour regarding signer.account.
  // - When you initially sign in, you get a SignedInAccount interface.
  // - When the extension loads after this, you get a PreviouslySignedInAccount interface.
  // This method normalises the behaviour to only return the SignedInAccount interface.
  if (contract && wallet.signer.account && "address" in wallet.signer.account) {
    await wallet.login({ contractId: contract.contractId });
  }

  return {
    wallet,
  };
};

const MathWallet: WalletBehaviourFactory<InjectedWallet> = async ({
  options,
  store,
  provider,
  logger,
}) => {
  const _state = await setupMathWalletState(store);

  const getSignedInAccount = () => {
    if (
      _state.wallet.signer.account &&
      "accountId" in _state.wallet.signer.account
    ) {
      return _state.wallet.signer.account;
    }

    return null;
  };

  const getAccounts = (): Array<AccountState> => {
    const account = getSignedInAccount();

    if (!account) {
      return [];
    }

    return [{ accountId: account.accountId }];
  };

  const transformTransactions = (
    transactions: Array<Optional<Transaction, "signerId" | "receiverId">>
  ): Array<Transaction> => {
    const account = getSignedInAccount();
    const { contract } = store.getState();

    if (!account || !contract) {
      throw new Error("Wallet not signed in");
    }

    return transactions.map((transaction) => {
      return {
        signerId: transaction.signerId || account.accountId,
        receiverId: transaction.receiverId || contract.contractId,
        actions: transaction.actions,
      };
    });
  };

  return {
    async signIn({ contractId }) {
      const existingAccounts = getAccounts();

      if (existingAccounts.length) {
        return existingAccounts;
      }

      await _state.wallet.login({ contractId });

      return getAccounts();
    },

    async signOut() {
      // Ignore if unsuccessful (returns false).
      await _state.wallet.logout();
    },

    async getAccounts() {
      return getAccounts();
    },

    async signAndSendTransaction({ signerId, receiverId, actions }) {
      logger.log("signAndSendTransaction", { signerId, receiverId, actions });
      const signedTransactions = await signTransactions(
        transformTransactions([{ signerId, receiverId, actions }]),
        _state.wallet.signer,
        options.network
      );

      return provider.sendTransaction(signedTransactions[0]);
    },

    async signAndSendTransactions({ transactions }) {
      logger.log("signAndSendTransactions", { transactions });

      const signedTransactions = await signTransactions(
        transformTransactions(transactions),
        _state.wallet.signer,
        options.network
      );

      logger.log(
        "signAndSendTransactions:signedTransactions",
        signedTransactions
      );

      return Promise.all(
        signedTransactions.map((tx) => provider.sendTransaction(tx))
      );
    },
  };
};

export const setupMathWallet = ({
  iconUrl = "./assets/math-wallet-icon.png",
}: MathWalletParams = {}): WalletModuleFactory<InjectedWallet> => {
  return async () => {
    const mobile = isMobile();
    const installed = await isInstalled();

    if (mobile || !installed) {
      return null;
    }

    return {
      id: "math-wallet",
      type: "injected",
      metadata: {
        name: "Math Wallet",
        description: null,
        iconUrl,
        downloadUrl:
          "https://chrome.google.com/webstore/detail/math-wallet/afbcbjpbpfadlkmhmclhkeeodmamcflc",
      },
      init: MathWallet,
    };
  };
};
