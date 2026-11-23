import React from 'react';
import { Building2, User, Eye, Store, ImagePlus } from 'lucide-react';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NichePicker from '@/components/niche/NichePicker';
import LogoUpload from '@/components/niche/LogoUpload';
import { getNiche, type NicheId } from '@/niches/registry';

interface StepIdentityProps {
  companyName: string;
  sdrName: string;
  businessNiche: string;
  logoUrl: string | null;
  onCompanyNameChange: (value: string) => void;
  onSdrNameChange: (value: string) => void;
  onBusinessNicheChange: (value: NicheId) => void;
  onLogoUrlChange: (value: string | null) => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

export const StepIdentity: React.FC<StepIdentityProps> = ({
  companyName,
  sdrName,
  businessNiche,
  logoUrl,
  onCompanyNameChange,
  onSdrNameChange,
  onBusinessNicheChange,
  onLogoUrlChange,
}) => {
  const niche = getNiche(businessNiche);
  return (
    <motion.div
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="text-center mb-6">
        <motion.div
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center"
          whileHover={{ scale: 1.05, rotate: 5 }}
          transition={{ type: "spring", stiffness: 400 }}
        >
          <Store className="w-8 h-8 text-primary" />
        </motion.div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Seu negócio</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Escolha o tipo do seu negócio. O sistema ajusta o funil, as palavras da tela e o jeito da assistente atender.
        </p>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-2">
        <Label className="flex items-center gap-2">
          <Store className="w-4 h-4 text-muted-foreground" />
          Tipo de negócio
        </Label>
        <NichePicker value={niche.id} onChange={onBusinessNicheChange} />
        <p className="text-xs text-muted-foreground">Dá para trocar depois em Configurações, e desfazer se não gostar.</p>
      </motion.div>

      <div className="space-y-6 max-w-md mx-auto">
        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="companyName" className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            Nome da empresa
          </Label>
          <Input
            id="companyName"
            value={companyName}
            onChange={(e) => onCompanyNameChange(e.target.value)}
            placeholder="Ex: Studio Belle, Burger do Zé, Silva Advogados"
            className="focus:ring-primary"
            data-testid="onboarding-company"
          />
          <p className="text-xs text-muted-foreground">Aparece no topo do sistema e nas mensagens da assistente</p>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <Label className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-muted-foreground" />
            Logo (opcional)
          </Label>
          <LogoUpload value={logoUrl} onChange={onLogoUrlChange} />
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="sdrName" className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Nome da Assistente
          </Label>
          <Input
            id="sdrName"
            value={sdrName}
            onChange={(e) => onSdrNameChange(e.target.value)}
            placeholder="Ex: Bella, Lis, Sofia, Clara..."
            className="focus:ring-primary"
            data-testid="onboarding-agent"
          />
          <p className="text-xs text-muted-foreground">Nome com o qual a assistente IA vai se apresentar para seus {niche.terms.clientes}</p>
        </motion.div>
      </div>

      {(companyName || sdrName) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="mt-8 p-4 rounded-xl bg-secondary/30 border border-border max-w-md mx-auto"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <Eye className="w-3 h-3" />
            Prévia
          </div>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-xl">{niche.emoji}</span>
            )}
            <div className="space-y-0.5 text-sm">
              <p className="text-foreground font-medium">{companyName || 'Sua empresa'}</p>
              <p className="text-muted-foreground text-xs">
                {niche.label} · assistente <span className="text-primary font-medium">{sdrName || 'Assistente'}</span>
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
